// A minimal Cordis function plugin for the Web GUI plugins/ directory.
//
// The loader imports a module that exports `apply(ctx)`. Anything registered
// through `ctx` (event listeners, services, tools, prompt sections, slots) is
// owned by this plugin's fiber and removed when it unloads — that is the
// registration-as-effect contract. This sample only writes a marker on stderr
// (bypassing the harness logger, which suppresses console.*) so its load into
// the running tree is observable.
export function apply(ctx) {
  process.stderr.write('[dsh-web:plugins/sample-plugin] loaded into the running tree\n')
}
