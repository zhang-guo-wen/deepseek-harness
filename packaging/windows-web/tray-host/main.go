// DshWebTray — a native Windows system-tray host for the DeepSeek Harness Web GUI.
//
// This is a small native (pure-Go, no console) executable that:
//   - spawns the bundled harness server (`node <install>\node\node.exe <install>\engine\lib\bin.js
//     web --patch <install>\plugins\cordis.patch.yml --port 0 --no-open`),
//   - reads the server's stdout to learn the actual random port,
//   - shows a system-tray icon with "打开页面" (open the default browser) and "退出",
//   - opens the page automatically on first successful launch.
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
	"sync"

	"github.com/getlantern/systray"
)

//go:embed tray-icon.ico
var trayIcon []byte

var (
	mu          sync.Mutex
	serverURL   string
	firstLaunch = true
	child       *exec.Cmd
)

func main() {
	systray.Run(onReady, onExit)
}

func onReady() {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	install := filepath.Dir(exe)
	nodeBin := filepath.Join(install, "node", "node.exe")
	engineBin := filepath.Join(install, "engine", "lib", "bin.js")
	pluginPatch := filepath.Join(install, "plugins", "cordis.patch.yml")
	dataDir := filepath.Join(install, "data")
	_ = os.MkdirAll(dataDir, 0o755)
	// A missing `--patch` file is a hard boot error; seed an empty list on first run.
	_ = os.MkdirAll(filepath.Dir(pluginPatch), 0o755)
	if !fileExists(pluginPatch) {
		_ = os.WriteFile(pluginPatch, []byte("# plugins/cordis.patch.yml — the launcher passes this to `dsh web` as --patch.\n[]\n"), 0o644)
	}

	systray.SetIcon(trayIcon)
	systray.SetTooltip("DeepSeek Harness Web")
	openItem := systray.AddMenuItem("打开页面", "在默认浏览器中打开")
	systray.AddSeparator()
	exitItem := systray.AddMenuItem("退出", "退出 DeepSeek Harness")

	// The install must be complete; spawn the server and learn the port from stdout.
	if fileExists(nodeBin) && fileExists(engineBin) {
		cmd := exec.Command(nodeBin, engineBin, "web", "--patch", pluginPatch, "--port", "0", "--no-open")
		cmd.Env = append(os.Environ(), "DSH_HOME="+dataDir, "DSH_CWD="+install)
		cmd.Stderr = nil // discard harness stderr; the tray app has no console
		stdout, _ := cmd.StdoutPipe()
		if err := cmd.Start(); err == nil {
			child = cmd
			go readURL(stdout)
		}
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

func onExit() {
	mu.Lock()
	c := child
	mu.Unlock()
	if c != nil && c.Process != nil {
		_ = c.Process.Kill()
	}
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

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
