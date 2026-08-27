// DshWebTray — a native Windows system-tray host for the DeepSeek Harness Web GUI.
//
// This is a small native (pure-Go, no console) executable that:
//   - spawns the bundled harness server (`node <install>\node\node.exe <install>\engine\lib\bin.js
//     web --patch <install>\plugins\cordis.patch.yml --port 0 --no-open`),
//   - reads the server's stdout to learn the actual random port,
//   - shows a system-tray icon with "打开页面" (open the default browser) and "退出",
//   - opens the page automatically on first successful launch,
//   - acts as a guardian: if the harness child process exits abnormally it is
//     restarted automatically; after too many crashes within a short window the
//     reboot is dropped and the reason is surfaced through a tray status item,
//     the tooltip, and a log file (the tray has no console).
//
// Built with `go build -ldflags "-H windowsgui"` so it runs without a console.
package main

import (
	"bufio"
	_ "embed"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/getlantern/systray"
)

//go:embed tray-icon.ico
var trayIcon []byte

var (
	mu          sync.Mutex
	serverURL   string
	firstLaunch = true
	child       *exec.Cmd
	// stopping 在用户主动点"退出"时置 true；之后守护不再拉起 harness。
	stopping bool
	// restartTimes 记录最近崩溃重启的时间戳，用于防止无限快速重启。
	restartTimes []time.Time
)

const (
	// maxRestarts 是重启窗口内允许的崩溃重启次数上限；超出即暂停拉起并提示。
	maxRestarts = 5
	// restartWindow 是崩溃统计窗口（纳秒）。
	restartWindow = 30 * time.Second
	// crashDelay 是连续两次拉起之间的间隔，避免瞬间反复重启。
	crashDelay = 2 * time.Second
)

func main() {
	systray.Run(onReady, onExit)
}

// harnessPaths 是一次启动所需的所有路径，保持 monitorLoop 自包含。
type harnessPaths struct {
	install     string
	nodeBin     string
	engineBin   string
	pluginPatch string
	logFile     string
}

func onReady() {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	install := filepath.Dir(exe)
	dataDir := readConfigHome(install)
	paths := harnessPaths{
		install:     install,
		nodeBin:     filepath.Join(install, "node", "node.exe"),
		engineBin:   filepath.Join(install, "engine", "lib", "bin.js"),
		pluginPatch: filepath.Join(install, "plugins", "cordis.patch.yml"),
		logFile:     filepath.Join(dataDir, "harness.log"),
	}
	// A missing `--patch` file is a hard boot error; seed an empty list on first run.
	_ = os.MkdirAll(filepath.Dir(paths.pluginPatch), 0o755)
	if !fileExists(paths.pluginPatch) {
		_ = os.WriteFile(paths.pluginPatch, []byte("# plugins/cordis.patch.yml — the launcher passes this to `dsh web` as --patch.\n[]\n"), 0o644)
	}

	systray.SetIcon(trayIcon)
	systray.SetTooltip("DeepSeek Harness Web")
	statusItem := systray.AddMenuItem("harness 运行中", "DeepSeek Harness 状态")
	openItem := systray.AddMenuItem("打开页面", "在默认浏览器中打开")
	systray.AddSeparator()
	exitItem := systray.AddMenuItem("退出", "退出 DeepSeek Harness")

	// 守护循环：只有 install 完整时才启动；异常退出自动拉起，超次暂停并提示。
	if fileExists(paths.nodeBin) && fileExists(paths.engineBin) {
		go monitorLoop(paths, statusItem)
	}

	go func() {
		for {
			select {
			case <-openItem.ClickedCh:
				mu.Lock()
				u := serverURL
				mu.Unlock()
				if u != "" {
					openBrowser(u)
				}
			case <-exitItem.ClickedCh:
				systray.Quit()
				return
			}
		}
	}()
}

// monitorLoop 是守护主体：循环拉起 harness 子进程，直到用户主动退出或连续
// 崩溃超过阈值。每次崩溃后按 crashDelay 隔开，避免瞬间反复重启。
func monitorLoop(paths harnessPaths, statusItem *systray.MenuItem) {
	for {
		quit := launchOnce(paths, statusItem)
		if quit {
			return // 用户主动退出，不再拉起
		}
		// 子进程异常退出：检查是否已连续崩溃过多。
		if overRestartBudget() {
			statusItem.SetTitle("harness 已暂停重启")
			tip := "harness 连续崩溃，已暂停自动重启。请查看日志：" + paths.logFile
			systray.SetTooltip(tip)
			statusItem.SetTooltip(tip)
			return
		}
		recordRestart()
		statusItem.SetTitle("正在重启 harness (" + strconv.Itoa(restartCount()) + ")")
		time.Sleep(crashDelay)
	}
}

// launchOnce 启动一次 harness 子进程并阻塞到它退出。返回是否用户主动退出
// （此时不该再拉起）。stdout 用于学习端口；stderr 落盘到日志文件供诊断。
func launchOnce(paths harnessPaths, statusItem *systray.MenuItem) bool {
	dataDir := readConfigHome(paths.install)
	_ = os.MkdirAll(dataDir, 0o755)

	cmd := exec.Command(paths.nodeBin, paths.engineBin, "web", "--patch", paths.pluginPatch, "--port", "0", "--no-open")
	cmd.Env = append(os.Environ(), "DSH_HOME="+dataDir, "DSH_CWD="+filepath.Dir(paths.nodeBin))

	// 把 harness 的 stderr 落盘（托盘程序无控制台，丢弃会掩盖崩溃原因）。
	logHandle, err := os.OpenFile(paths.logFile, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		logHandle = nil // 日志不可写不阻塞启动
	}
	if logHandle != nil {
		cmd.Stderr = logHandle
	}

	stdout, pipeErr := cmd.StdoutPipe()
	if pipeErr == nil {
		if err := cmd.Start(); err != nil {
			mu.Lock()
			stoppingAtCrash := stopping
			mu.Unlock()
			if logHandle != nil {
				logHandle.Close()
			}
			statusItem.SetTitle("harness 启动失败")
			if !stoppingAtCrash {
				return false // 触发守护重试
			}
			return true
		}
		mu.Lock()
		child = cmd
		mu.Unlock()

		// 等待子进程退出：先学习端口，再阻塞到 exit。
		readURL(stdout)
		waitErr := cmd.Wait()
		if logHandle != nil {
			logHandle.Close()
		}

		mu.Lock()
		child = nil
		stoppingAtCrash := stopping
		mu.Unlock()

		if stoppingAtCrash {
			return true
		}
		_ = waitErr
		return false // 异常退出，返回给守护循环去拉起
	}

	// stdout 管道创建失败：仍尝试直接启动（无端口学习），同样守护。
	if err := cmd.Start(); err != nil {
		statusItem.SetTitle("harness 启动失败")
		mu.Lock()
		quit := stopping
		mu.Unlock()
		if logHandle != nil {
			logHandle.Close()
		}
		return !quit
	}
	mu.Lock()
	child = cmd
	mu.Unlock()
	waitErr := cmd.Wait()
	if logHandle != nil {
		logHandle.Close()
	}
	mu.Lock()
	child = nil
	quit := stopping
	mu.Unlock()
	if quit {
		return true
	}
	_ = waitErr
	return false
}

// readURL scans the harness stdout for its published URL and, on first success,
// opens the page automatically.
func readURL(stdout io.ReadCloser) {
	defer stdout.Close()
	re := regexp.MustCompile(`http://127\.0\.0\.1:(\d+)`)
	sc := bufio.NewScanner(stdout)
	for sc.Scan() {
		if m := re.FindStringSubmatch(sc.Text()); m != nil {
			mu.Lock()
			serverURL = "http://127.0.0.1:" + m[1]
			first := firstLaunch
			firstLaunch = false
			mu.Unlock()
			if first {
				openBrowser(serverURL)
			}
		}
	}
}

// openBrowser hands a URL to the system default browser.
func openBrowser(url string) {
	_ = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
}

func onExit() {
	mu.Lock()
	stopping = true
	c := child
	mu.Unlock()
	if c != nil && c.Process != nil {
		_ = c.Process.Kill()
	}
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// readConfigHome 读取安装器写入的 <install>/dsh-config.txt 里的 DSH_HOME。
// 文件缺失、不可读或值为空时回退到自包含的 <install>/data。
func readConfigHome(install string) string {
	configPath := filepath.Join(install, "dsh-config.txt")
	raw, err := os.ReadFile(configPath)
	if err != nil {
		return filepath.Join(install, "data")
	}
	for _, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimRight(line, "\r")
		key, value, ok := strings.Cut(line, "=")
		if ok && strings.TrimSpace(key) == "DSH_HOME" {
			if home := strings.TrimSpace(value); home != "" {
				return home
			}
		}
	}
	return filepath.Join(install, "data")
}

// pruneOldRestarts 丢弃窗口外的崩溃记录，使计数只反映最近 restartWindow。
func pruneOldRestarts(now time.Time) {
	cutoff := now.Add(-restartWindow)
	kept := restartTimes[:0]
	for _, t := range restartTimes {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	restartTimes = kept
}

// overRestartBudget 判断窗口内崩溃次数是否已达阈值（用于暂停拉起）。
func overRestartBudget() bool {
	mu.Lock()
	defer mu.Unlock()
	pruneOldRestarts(time.Now())
	return len(restartTimes) >= maxRestarts
}

// recordRestart 记录一次崩溃（在拉起前调用）。
func recordRestart() {
	mu.Lock()
	defer mu.Unlock()
	pruneOldRestarts(time.Now())
	restartTimes = append(restartTimes, time.Now())
}

// restartCount 返回窗口内已记录的崩溃次数。
func restartCount() int {
	mu.Lock()
	defer mu.Unlock()
	pruneOldRestarts(time.Now())
	return len(restartTimes)
}
