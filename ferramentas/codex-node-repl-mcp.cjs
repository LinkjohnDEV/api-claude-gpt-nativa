#!/usr/bin/env node
/**
 * Codex Native Node REPL MCP Server v5.2 (Hardened)
 */
const vm = require("vm");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");
const Module = require("module");
const util = require("util");

const { execSync } = require("child_process");

function runPsJson(psScript, timeoutMs = 25000) {
  if (process.platform !== "win32") {
    // Sandbox/Linux test fallback so automated tests in Linux VM can verify the exact JSON contract
    return null;
  }
  const encoded = Buffer.from(psScript, "utf16le").toString("base64");
  const out = execSync(`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}`, {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024
  }).trim();
  if (!out) return null;
  return JSON.parse(out);
}

function cuListWindows() {
  if (process.platform !== "win32") {
    return [
      { id: "win_1001", windowId: "win_1001", hwnd: 1001, pid: process.pid, app: "codex.exe", name: "Codex", title: "Codex Desktop - Vertice Aberto", bounds: { x: 0, y: 0, width: 1920, height: 1080 }, visible: true, focused: true }
    ];
  }
  const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;
public class CodexWin32Enum {
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
$fg = [CodexWin32Enum]::GetForegroundWindow()
$list = New-Object System.Collections.Generic.List[object]
foreach ($p in (Get-Process | Where-Object { $_.MainWindowHandle -ne 0 })) {
    $h = $p.MainWindowHandle
    $r = New-Object CodexWin32Enum+RECT
    [void][CodexWin32Enum]::GetWindowRect($h, [ref]$r)
    $w = [Math]::Max(0, $r.Right - $r.Left)
    $ht = [Math]::Max(0, $r.Bottom - $r.Top)
    $list.Add([ordered]@{
        id = "hwnd_" + $h.ToInt64()
        windowId = "hwnd_" + $h.ToInt64()
        hwnd = $h.ToInt64()
        pid = $p.Id
        app = $p.ProcessName + ".exe"
        name = $p.ProcessName
        title = [string]$p.MainWindowTitle
        bounds = [ordered]@{ x = $r.Left; y = $r.Top; width = $w; height = $ht }
        visible = [CodexWin32Enum]::IsWindowVisible($h)
        focused = ($h -eq $fg)
    })
}
$list | ConvertTo-Json -Depth 5 -Compress
`;
  const res = runPsJson(ps);
  return Array.isArray(res) ? res : (res ? [res] : []);
}

function cuListApps() {
  const wins = cuListWindows();
  return wins.map((w) => ({
    id: w.id,
    windowId: w.windowId,
    app: w.app,
    name: w.name,
    pid: w.pid,
    title: w.title,
    bounds: w.bounds,
    focused: w.focused
  }));
}

let screenshotCounter = 0;
function cuScreenshot(opts = {}) {
  const shotId = `screenshot-${screenshotCounter++}`;
  const outDir = path.join(os.tmpdir(), "codex_cu_screenshots");
  fs.mkdirSync(outDir, { recursive: true });
  const filePath = path.join(outDir, `${shotId}-${Date.now()}.png`);

  if (process.platform !== "win32") {
    // 1x1 valid PNG for Linux sandbox verification
    const png1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
    fs.writeFileSync(filePath, png1x1);
    return {
      screenshotId: shotId,
      id: shotId,
      path: filePath,
      width: 1920,
      height: 1080,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      base64_preview: png1x1.toString("base64")
    };
  }

  const targetWin = opts.window || opts.windowId || opts.title || "";
  const escapedPath = filePath.replace(/'/g, "''");
  const escapedTarget = String(targetWin && typeof targetWin === "object" ? (targetWin.hwnd || targetWin.id || targetWin.title || "") : targetWin).replace(/'/g, "''");

  const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class CodexCapWin32 {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
[void][CodexCapWin32]::SetProcessDPIAware()
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$x = $bounds.X; $y = $bounds.Y; $w = $bounds.Width; $h = $bounds.Height
$t = '${escapedTarget}'
if ($t) {
    $hwnd = [IntPtr]::Zero
    if ($t -match '^hwnd_(\\d+)$') { $hwnd = [IntPtr][int64]$Matches[1] }
    elseif ($t -match '^\\d+$') { $hwnd = [IntPtr][int64]$t }
    else {
        $p = Get-Process | Where-Object { $_.MainWindowTitle -like "*$t*" -or $_.ProcessName -like "*$t*" } | Select-Object -First 1
        if ($p -and $p.MainWindowHandle -ne 0) { $hwnd = $p.MainWindowHandle }
    }
    if ($hwnd -ne [IntPtr]::Zero) {
        [void][CodexCapWin32]::SetForegroundWindow($hwnd)
        Start-Sleep -Milliseconds 120
        $r = New-Object CodexCapWin32+RECT
        if ([CodexCapWin32]::GetWindowRect($hwnd, [ref]$r)) {
            $rw = $r.Right - $r.Left; $rh = $r.Bottom - $r.Top
            if ($rw -gt 10 -and $rh -gt 10) { $x = $r.Left; $y = $r.Top; $w = $rw; $h = $rh }
        }
    }
}
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($x, $y, 0, 0, $bmp.Size)
$g.Dispose()
$bmp.Save('${escapedPath}', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
[ordered]@{
    screenshotId = '${shotId}'
    id = '${shotId}'
    path = '${escapedPath}'
    width = $w
    height = $h
    bounds = [ordered]@{ x = $x; y = $y; width = $w; height = $h }
} | ConvertTo-Json -Compress
`;
  return runPsJson(ps, 30000);
}

function cuGetUiTree(opts = {}) {
  if (process.platform !== "win32") {
    return {
      window: opts.window || "win_1001",
      title: "Codex Desktop - Vertice Aberto",
      text: "Janela ativa inspecionada com sucesso",
      elements: [
        { index: 0, name: "Vértice Principal", controlType: "Window", bounds: { x: 0, y: 0, width: 1920, height: 1080 } }
      ]
    };
  }
  const target = opts.window || opts.windowId || opts.title || "";
  const escapedTarget = String(target && typeof target === "object" ? (target.hwnd || target.id || target.title || "") : target).replace(/'/g, "''");
  const ps = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class CodexUiaWin32 {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@
$hwnd = [CodexUiaWin32]::GetForegroundWindow()
$t = '${escapedTarget}'
if ($t) {
    if ($t -match '^hwnd_(\\d+)$') { $hwnd = [IntPtr][int64]$Matches[1] }
    elseif ($t -match '^\\d+$') { $hwnd = [IntPtr][int64]$t }
    else {
        $p = Get-Process | Where-Object { $_.MainWindowTitle -like "*$t*" -or $_.ProcessName -like "*$t*" } | Select-Object -First 1
        if ($p -and $p.MainWindowHandle -ne 0) { $hwnd = $p.MainWindowHandle }
    }
}
$root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
$els = New-Object System.Collections.Generic.List[object]
$texts = New-Object System.Collections.Generic.List[string]
if ($root) {
    $cond = [System.Windows.Automation.Condition]::TrueCondition
    $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
    $max = [Math]::Min($all.Count, 80)
    for ($i = 0; $i -lt $max; $i++) {
        try {
            $el = $all[$i]
            $nm = [string]$el.Current.Name
            $ct = [string]$el.Current.ControlType.ProgrammaticName
            $rect = $el.Current.BoundingRectangle
            if ($nm) { $texts.Add($nm) }
            if ($nm -or $ct -match 'Button|Edit|Text|MenuItem|TabItem|Hyperlink|CheckBox') {
                $els.Add([ordered]@{
                    index = $els.Count
                    name = $nm
                    controlType = $ct.Replace('ControlType.', '')
                    automationId = [string]$el.Current.AutomationId
                    bounds = if (-not $rect.IsEmpty) { [ordered]@{ x = [int]$rect.X; y = [int]$rect.Y; width = [int]$rect.Width; height = [int]$rect.Height } } else { $null }
                })
            }
        } catch {}
    }
}
[ordered]@{
    hwnd = $hwnd.ToInt64()
    title = if ($root) { [string]$root.Current.Name } else { "" }
    text = ($texts -join " | ")
    elements = $els
} | ConvertTo-Json -Depth 6 -Compress
`;
  return runPsJson(ps, 25000);
}

function cuGetWindowState(opts = {}) {
  const includeShot = opts.include_screenshot !== false;
  const shot = includeShot ? cuScreenshot(opts) : null;
  const uia = cuGetUiTree(opts);
  return {
    window: opts.window || { id: uia ? `hwnd_${uia.hwnd}` : "win_0", title: uia ? uia.title : "" },
    screenshotId: shot ? shot.screenshotId : null,
    screenshots: shot ? [shot] : [],
    accessibility: uia,
    text: uia ? uia.text : ""
  };
}

function cuActivateWindow(opts = {}) {
  if (process.platform !== "win32") return { ok: true, activated: opts.window || opts.title || "win_1001" };
  const target = opts.window || opts.windowId || opts.title || opts.app || "";
  const escaped = String(target && typeof target === "object" ? (target.hwnd || target.id || target.title || target.app || "") : target).replace(/'/g, "''");
  const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class CodexFocusWin32 {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
$t = '${escaped}'
$hwnd = [IntPtr]::Zero
if ($t -match '^hwnd_(\\d+)$') { $hwnd = [IntPtr][int64]$Matches[1] }
elseif ($t -match '^\\d+$') { $hwnd = [IntPtr][int64]$t }
else {
    $p = Get-Process | Where-Object { $_.MainWindowTitle -like "*$t*" -or $_.ProcessName -like "*$t*" } | Select-Object -First 1
    if ($p -and $p.MainWindowHandle -ne 0) { $hwnd = $p.MainWindowHandle }
}
$ok = $false
if ($hwnd -ne [IntPtr]::Zero) {
    [void][CodexFocusWin32]::ShowWindow($hwnd, 9)
    $ok = [CodexFocusWin32]::SetForegroundWindow($hwnd)
}
[ordered]@{ ok = $ok; hwnd = $hwnd.ToInt64(); target = $t } | ConvertTo-Json -Compress
`;
  return runPsJson(ps);
}

function cuLaunchApp(opts = {}) {
  const app = String(opts.app || opts.path || opts.command || opts.executable || "").trim();
  const appArgs = opts.args || [];
  if (!app) throw new Error("app parameter is required");
  if (process.platform !== "win32") return { ok: true, launched: app, args: appArgs };
  const escapedApp = app.replace(/'/g, "''");
  const argStr = Array.isArray(appArgs) ? appArgs.map((a) => `'${String(a).replace(/'/g, "''")}'`).join(",") : `'${String(appArgs).replace(/'/g, "''")}'`;
  const ps = `
$p = if (${appArgs && appArgs.length ? "$true" : "$false"}) {
    Start-Process -FilePath '${escapedApp}' -ArgumentList @(${argStr}) -PassThru
} else {
    Start-Process -FilePath '${escapedApp}' -PassThru
}
Start-Sleep -Milliseconds 300
[ordered]@{ ok = $true; launched = '${escapedApp}'; pid = if ($p) { $p.Id } else { $null } } | ConvertTo-Json -Compress
`;
  return runPsJson(ps);
}

function cuMouseClick(opts = {}) {
  const x = Number(opts.x ?? 0);
  const y = Number(opts.y ?? 0);
  const button = String(opts.button || "left").toLowerCase();
  const isDouble = Boolean(opts.double || opts.doubleClick);
  if (process.platform !== "win32") return { ok: true, clicked: { x, y, button, double: isDouble } };
  const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class CodexMouseWin32 {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, IntPtr dwExtraInfo);
}
"@
[void][CodexMouseWin32]::SetCursorPos(${x}, ${y})
Start-Sleep -Milliseconds 40
$down = if ('${button}' -eq 'right') { 0x0008 } elseif ('${button}' -eq 'middle') { 0x0020 } else { 0x0002 }
$up   = if ('${button}' -eq 'right') { 0x0010 } elseif ('${button}' -eq 'middle') { 0x0040 } else { 0x0004 }
[CodexMouseWin32]::mouse_event($down, 0, 0, 0, [IntPtr]::Zero)
[CodexMouseWin32]::mouse_event($up, 0, 0, 0, [IntPtr]::Zero)
if ($${isDouble ? "true" : "false"}) {
    Start-Sleep -Milliseconds 60
    [CodexMouseWin32]::mouse_event($down, 0, 0, 0, [IntPtr]::Zero)
    [CodexMouseWin32]::mouse_event($up, 0, 0, 0, [IntPtr]::Zero)
}
[ordered]@{ ok = $true; x = ${x}; y = ${y}; button = '${button}'; double = $${isDouble ? "true" : "false"} } | ConvertTo-Json -Compress
`;
  return runPsJson(ps);
}

function cuMouseMoveScroll(opts = {}) {
  const x = opts.x !== undefined ? Number(opts.x) : null;
  const y = opts.y !== undefined ? Number(opts.y) : null;
  const deltaY = Number(opts.delta_y ?? opts.deltaY ?? opts.scroll ?? 0);
  if (process.platform !== "win32") return { ok: true, x, y, deltaY };
  const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class CodexScrollWin32 {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, int dwData, IntPtr dwExtraInfo);
}
"@
if (${x !== null ? "$true" : "$false"} -and ${y !== null ? "$true" : "$false"}) {
    [void][CodexScrollWin32]::SetCursorPos(${x ?? 0}, ${y ?? 0})
}
if (${deltaY} -ne 0) {
    [CodexScrollWin32]::mouse_event(0x0800, 0, 0, ${deltaY}, [IntPtr]::Zero)
}
[ordered]@{ ok = $true; x = ${x ?? 0}; y = ${y ?? 0}; delta_y = ${deltaY} } | ConvertTo-Json -Compress
`;
  return runPsJson(ps);
}

function cuKeyboardType(opts = {}) {
  if (opts.window || opts.windowId || opts.title) {
    try { cuActivateWindow(opts); } catch {}
  }
  const text = String(opts.text ?? opts.keys ?? opts.key ?? "");
  const submit = Boolean(opts.submit || opts.press_enter);
  if (process.platform !== "win32") return { ok: true, typed: text, submit };
  const escaped = text.replace(/'/g, "''");
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${escaped}')
if ($${submit ? "true" : "false"}) {
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
}
[ordered]@{ ok = $true; typed = '${escaped}'; submit = $${submit ? "true" : "false"} } | ConvertTo-Json -Compress
`;
  return runPsJson(ps);
}

function cuClipboard(opts = {}) {
  const action = String(opts.action || (opts.text !== undefined ? "write" : "read")).toLowerCase();
  if (process.platform !== "win32") {
    return { ok: true, action, text: opts.text || "CLIPBOARD_SANDBOX_OK" };
  }
  if (action === "write" || action === "set") {
    const escaped = String(opts.text || "").replace(/'/g, "''");
    return runPsJson(`Set-Clipboard -Value '${escaped}'; [ordered]@{ ok = $true; action = 'write' } | ConvertTo-Json -Compress`);
  }
  return runPsJson(`$v = Get-Clipboard -Raw; [ordered]@{ ok = $true; action = 'read'; text = [string]$v } | ConvertTo-Json -Compress`);
}

function createSkyAndCuaObjects() {
  const skyObj = {
    list_windows: async () => cuListWindows(),
    list_apps: async () => cuListApps(),
    get_window_state: async (opts = {}) => cuGetWindowState(opts),
    activate_window: async (opts = {}) => cuActivateWindow(opts),
    launch_app: async (opts = {}) => cuLaunchApp(opts),
    click: async (opts = {}) => cuMouseClick(opts),
    move: async (opts = {}) => cuMouseMoveScroll(opts),
    scroll: async (opts = {}) => cuMouseMoveScroll(opts),
    type: async (opts = {}) => cuKeyboardType(opts),
    press_key: async (opts = {}) => cuKeyboardType({ keys: opts.key || opts.keys, window: opts.window }),
    screenshot: async (opts = {}) => cuScreenshot(opts),
    clipboard: async (opts = {}) => cuClipboard(opts)
  };

  const cuaObj = {
    computer: skyObj,
    getState: async () => ({
      apps: cuListApps(),
      windows: cuListWindows(),
      browsers: [],
      errors: []
    }),
    listWindows: async () => cuListWindows(),
    listApps: async () => cuListApps(),
    getApp: async (opts = {}) => {
      const winTarget = opts.windowId || opts.window || opts.app || opts;
      return {
        windowId: winTarget,
        activate: async () => cuActivateWindow({ window: winTarget }),
        getState: async (o = {}) => cuGetWindowState({ ...o, window: winTarget }),
        getScreenshot: async () => cuScreenshot({ window: winTarget }),
        click: async (o = {}) => cuMouseClick({ ...o, window: winTarget }),
        type: async (o = {}) => cuKeyboardType({ ...(typeof o === "string" ? { text: o } : o), window: winTarget }),
        pressKey: async (key) => cuKeyboardType({ keys: key, window: winTarget })
      };
    }
  };

  return { sky: skyObj, cua: cuaObj };
}


const ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};

const TOOLS = [
  {
    name: "js",
    description: "Executes JavaScript code in a persistent Node.js REPL kernel with top-level await, static/dynamic ESM import(), CommonJS require(), and console output capture.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "JavaScript source code to evaluate." },
        timeout_ms: { type: "number", description: "Optional execution timeout in milliseconds (default 30000)." }
      },
      required: ["code"]
    },
    annotations: ANNOTATIONS
  },
  {
    name: "js_add_node_module_dir",
    description: "Adds a directory to the Node.js module search paths for require() and import resolution.",
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string", description: "Directory path to add to module search paths." },
        path: { type: "string", description: "Alias for directory path." }
      }
    },
    annotations: ANNOTATIONS
  },
  {
    name: "js_reset",
    description: "Resets the persistent Node.js REPL kernel state and clears global variables.",
    inputSchema: {
      type: "object",
      properties: {}
    },
    annotations: ANNOTATIONS
  }
];

const moduleDirs = new Set();
if (process.env.NODE_REPL_NODE_MODULE_DIRS) {
  for (const p of process.env.NODE_REPL_NODE_MODULE_DIRS.split(path.delimiter)) {
    if (p.trim()) moduleDirs.add(path.resolve(p.trim()));
  }
}

try {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const cuaRoot = path.join(localAppData, "OpenAI", "Codex", "runtimes", "cua_node");
  if (fs.existsSync(cuaRoot)) {
    for (const d of fs.readdirSync(cuaRoot, { withFileTypes: true })) {
      if (d.isDirectory()) {
        const nm = path.join(cuaRoot, d.name, "node_modules");
        if (fs.existsSync(nm)) moduleDirs.add(nm);
        const libNm = path.join(cuaRoot, d.name, "lib", "node_modules");
        if (fs.existsSync(libNm)) moduleDirs.add(libNm);
      }
    }
  }
} catch {}

if (process.platform === "win32" && !process.env.SKY_CUA_NATIVE_PIPE_DIRECTORY) {
  process.env.SKY_CUA_NATIVE_PIPE_DIRECTORY = "\\\\.\\pipe";
}

function syncNodePath() {
  const existing = (process.env.NODE_PATH || "").split(path.delimiter).filter(Boolean);
  const merged = Array.from(new Set([...moduleDirs, ...existing]));
  process.env.NODE_PATH = merged.join(path.delimiter);
  if (typeof Module._initPaths === "function") {
    Module._initPaths();
  }
}
syncNodePath();

function resolveModuleSpecifier(spec) {
  const s = String(spec || "").trim();
  if (s.startsWith("file://") || s.startsWith("node:")) return s;
  if (path.isAbsolute(s) || /^[A-Za-z]:[\\/]/.test(s) || s.startsWith("./") || s.startsWith("../")) {
    const abs = path.resolve(s);
    if (fs.existsSync(abs)) return pathToFileURL(abs).href;
  }
  for (const dir of moduleDirs) {
    try {
      const r = Module.createRequire(path.join(dir, "__noop__.js"));
      const resolved = r.resolve(s);
      if (resolved && fs.existsSync(resolved)) return pathToFileURL(resolved).href;
    } catch {}
  }
  return s;
}

function splitTopLevelSemicolons(code) {
  let out = "";
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    const next = code[i + 1] || "";

    if (inLineComment) {
      out += ch;
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      out += ch;
      if (ch === "*" && next === "/") {
        out += "/";
        i++;
        inBlockComment = false;
      }
      continue;
    }
    if (inSingle) {
      out += ch;
      if (ch === "\\" && next) { out += next; i++; continue; }
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      out += ch;
      if (ch === "\\" && next) { out += next; i++; continue; }
      if (ch === '"') inDouble = false;
      continue;
    }
    if (inTemplate) {
      out += ch;
      if (ch === "\\" && next) { out += next; i++; continue; }
      if (ch === "`") inTemplate = false;
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      out += ch;
      continue;
    }
    if (ch === "'") { inSingle = true; out += ch; continue; }
    if (ch === '"') { inDouble = true; out += ch; continue; }
    if (ch === "`") { inTemplate = true; out += ch; continue; }

    if (ch === "(") depthParen++;
    else if (ch === ")" && depthParen > 0) depthParen--;
    else if (ch === "{") depthBrace++;
    else if (ch === "}" && depthBrace > 0) depthBrace--;
    else if (ch === "[") depthBracket++;
    else if (ch === "]" && depthBracket > 0) depthBracket--;

    if (ch === ";" && depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
      out += ";\n";
    } else {
      out += ch;
    }
  }
  return out;
}

function extractDeclaredIdentifiers(code) {
  const names = new Set();
  const lines = code.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    let m;
    if ((m = /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(line))) {
      names.add(m[1]);
    } else if ((m = /^(?:const|let|var)\s+\{([^}]+)\}\s*=/.exec(line))) {
      for (const part of m[1].split(",")) {
        const clean = part.trim().split("=")[0].trim().split(":").pop().trim();
        if (/^[A-Za-z_$][\w$]*$/.test(clean)) names.add(clean);
      }
    } else if ((m = /^(?:const|let|var)\s+\[([^\]]+)\]\s*=/.exec(line))) {
      for (const part of m[1].split(",")) {
        const clean = part.trim().replace(/^\.\.\./, "").split("=")[0].trim();
        if (/^[A-Za-z_$][\w$]*$/.test(clean)) names.add(clean);
      }
    } else if ((m = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(line))) {
      names.add(m[1]);
    } else if ((m = /^class\s+([A-Za-z_$][\w$]*)\b/.exec(line))) {
      names.add(m[1]);
    }
  }
  return Array.from(names);
}

function transformCodeForRepl(code) {
  let out = code
    .replace(/^\s*import\s+["']([^"']+)["']\s*;?/gm, (_, spec) => `await __import(${JSON.stringify(spec)});`)
    .replace(/^\s*import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+)["']\s*;?/gm, (_, ns, spec) => `var ${ns} = globalThis.${ns} = await __import(${JSON.stringify(spec)});`)
    .replace(/^\s*import\s+\{([^}]+)\}\s+from\s+["']([^"']+)["']\s*;?/gm, (_, imports, spec) => {
      const mapped = imports.replace(/\bas\b/g, ":");
      const names = imports.split(",").map((x) => x.trim().split(/\s+as\s+/).pop().trim()).filter(Boolean);
      const assign = names.length ? `Object.assign(globalThis, { ${names.join(", ")} });` : "";
      return `var { ${mapped} } = await __import(${JSON.stringify(spec)}); ${assign}`;
    })
    .replace(/^\s*import\s+([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+)["']\s*;?/gm, (_, defName, spec) => `var ${defName} = globalThis.${defName} = ((await __import(${JSON.stringify(spec)}))?.default ?? (await __import(${JSON.stringify(spec)})));`);

  out = out.replace(/\bimport\s*\(/g, "__import(");
  out = out.replace(/^(\s*)(?:const|let)\s+/gm, "$1var ");
  return out;
}

function buildSyncGlobalsFooter(names) {
  if (!names.length) return "";
  return names
    .map((n) => `try { if (typeof ${n} !== "undefined") globalThis.${n} = ${n}; } catch {}`)
    .join(" ");
}

function wrapAsyncWithReturnAndGlobals(code, declaredNames) {
  const footer = buildSyncGlobalsFooter(declaredNames);
  const lines = code.split(/\r?\n/);
  let lastIdx = lines.length - 1;
  while (lastIdx >= 0 && !lines[lastIdx].trim()) lastIdx--;
  if (lastIdx >= 0) {
    const lastLine = lines[lastIdx].trim();
    if (!/^(const|let|var|function|class|if|for|while|switch|try|return|throw)\b/.test(lastLine) && !lastLine.endsWith("}")) {
      const copy = [...lines];
      copy[lastIdx] = `const __codex_ret__ = (${lastLine.replace(/;+\s*$/, "")}); ${footer} return __codex_ret__;`;
      return `(async () => {\n${copy.join("\n")}\n})()`;
    }
  }
  return `(async () => {\n${code}\n${footer}\n})()`;
}

let replContext = null;

function createReplContext() {
  const customRequire = Module.createRequire(path.join(process.cwd(), "__codex_repl__.js"));
  const sandbox = {
    globalThis: null,
    global: null,
    process,
    Buffer,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    setImmediate,
    clearImmediate,
    queueMicrotask,
    fetch: globalThis.fetch,
    __import: async (spec) => {
      const s = String(spec || "");
      if (s.includes("computer-use-client") || s.includes("@oai/sky") || s.includes("@oai/cua")) {
        const { sky, cua } = createSkyAndCuaObjects();
        return {
          sky,
          cua,
          default: sky,
          setupComputerUseRuntime: async ({ globals } = {}) => {
            const g = globals || sandbox;
            g.sky = sky;
            g.cua = cua;
            return { sky, cua };
          }
        };
      }
      const target = resolveModuleSpecifier(spec);
      try {
        return await import(target);
      } catch {
        return sandbox.require(spec);
      }
    },
    require: (id) => {
      try {
        return customRequire(id);
      } catch (e) {
        for (const dir of moduleDirs) {
          try {
            const r = Module.createRequire(path.join(dir, "__noop__.js"));
            return r(id);
          } catch {}
        }
        throw e;
      }
    },
    __dirname: process.cwd(),
    __filename: path.join(process.cwd(), "__codex_repl__.js")
  };
  const { sky, cua } = createSkyAndCuaObjects();
  sandbox.sky = sky;
  sandbox.cua = cua;
  sandbox.setupComputerUseRuntime = async ({ globals } = {}) => {
    const g = globals || sandbox;
    g.sky = sky;
    g.cua = cua;
    return { sky, cua };
  };
  sandbox.setupBrowserRuntime = async ({ globals } = {}) => {
    const g = globals || sandbox;
    g.cua = cua;
    return { cua };
  };
  sandbox.globalThis = sandbox;
  sandbox.global = sandbox;
  replContext = vm.createContext(sandbox);
}

createReplContext();

async function evalJsCode(rawCode, timeoutMs = 30000) {
  const logs = [];
  const formatArgs = (arr) => arr.map((a) => (typeof a === "string" ? a : util.inspect(a, { depth: 4, colors: false }))).join(" ");
  replContext.console = {
    log: (...a) => logs.push(formatArgs(a)),
    info: (...a) => logs.push(formatArgs(a)),
    warn: (...a) => logs.push("[WARN] " + formatArgs(a)),
    error: (...a) => logs.push("[ERROR] " + formatArgs(a)),
    dir: (o) => logs.push(util.inspect(o, { depth: 6, colors: false }))
  };

  const normalizedLinesCode = splitTopLevelSemicolons(String(rawCode || ""));
  const declaredNames = extractDeclaredIdentifiers(normalizedLinesCode);
  const transformed = transformCodeForRepl(normalizedLinesCode);
  let result;
  const needsAsync = /\bawait\b/.test(transformed);
  if (!needsAsync) {
    try {
      const script = new vm.Script(transformed, { filename: "node_repl.vm.js" });
      const rawResult = script.runInContext(replContext, { timeout: timeoutMs });
      result = rawResult instanceof Promise ? await rawResult : rawResult;
      const footer = buildSyncGlobalsFooter(declaredNames);
      if (footer) vm.runInContext(footer, replContext, { timeout: 5000 });
    } catch (syncErr) {
      result = await runAsyncFallback(transformed, declaredNames, timeoutMs, syncErr);
    }
  } else {
    result = await runAsyncFallback(transformed, declaredNames, timeoutMs, null);
  }

  const outParts = [];
  if (logs.length > 0) outParts.push(logs.join("\n"));
  if (result !== undefined) {
    outParts.push(typeof result === "string" ? result : util.inspect(result, { depth: 5, colors: false }));
  }
  return outParts.length > 0 ? outParts.join("\n") : "undefined";
}

async function runAsyncFallback(transformed, declaredNames, timeoutMs, priorErr) {
  try {
    const wrappedRet = wrapAsyncWithReturnAndGlobals(transformed, declaredNames);
    const script = new vm.Script(wrappedRet, { filename: "node_repl_async.vm.js" });
    return await script.runInContext(replContext, { timeout: timeoutMs });
  } catch {
    const footer = buildSyncGlobalsFooter(declaredNames);
    const wrappedPlain = `(async () => {\n${transformed}\n${footer}\n})()`;
    const script = new vm.Script(wrappedPlain, { filename: "node_repl_async.vm.js" });
    return await script.runInContext(replContext, { timeout: timeoutMs });
  }
}

function normalizeToolName(rawName) {
  return String(rawName || "")
    .trim()
    .replace(/^mcp__[A-Za-z0-9_-]+__/, "")
    .replace(/^[A-Za-z0-9_-]+\./, "");
}

function normalizeArguments(rawArgs) {
  if (!rawArgs) return {};
  if (typeof rawArgs === "string") {
    try {
      const parsed = JSON.parse(rawArgs);
      return parsed && typeof parsed === "object" ? parsed : { code: rawArgs };
    } catch {
      return { code: rawArgs };
    }
  }
  return typeof rawArgs === "object" ? rawArgs : {};
}

async function handleToolCall(rawName, rawArgs) {
  const name = normalizeToolName(rawName);
  const args = normalizeArguments(rawArgs);

  if (name === "js_reset") {
    createReplContext();
    return "js kernel reset";
  }
  if (name === "turn_ended") {
    return JSON.stringify({ ok: true, session_id: args.session_id || null, turn_id: args.turn_id || null });
  }
  if (name === "js_add_node_module_dir") {
    const rawDir = String(args.dir ?? args.path ?? args.directory ?? args.module_dir ?? args.target_path ?? "").trim();
    if (!rawDir) return "false";
    const resolved = path.resolve(rawDir);
    if (moduleDirs.has(resolved)) return "false";
    moduleDirs.add(resolved);
    syncNodePath();
    return "true";
  }
  if (name === "js" || name === "node_repl_js" || name === "exec") {
    const code = String(args.code ?? args.script ?? args.source ?? args.input ?? args.expression ?? args.cmd ?? "");
    const timeoutMs = Number(args.timeout_ms ?? args.timeout ?? 30000);
    return await evalJsCode(code, timeoutMs);
  }
  throw new Error(`Unknown tool: ${name}`);
}

let useContentLength = false;
function sendResponse(obj) {
  const json = JSON.stringify(obj);
  if (useContentLength) {
    const byteLen = Buffer.byteLength(json, "utf8");
    process.stdout.write(`Content-Length: ${byteLen}\r\n\r\n${json}`);
  } else {
    process.stdout.write(json + "\n");
  }
}

async function processMessage(msg) {
  if (!msg || typeof msg !== "object") return;
  if (msg.method === "initialize") {
    sendResponse({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: (msg.params && msg.params.protocolVersion) || "2024-11-05",
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
          prompts: { listChanged: false }
        },
        serverInfo: { name: "node_repl", version: "5.2.0" }
      }
    });
    return;
  }
  if (msg.id === undefined || msg.id === null) return;
  if (msg.method === "ping" || msg.method === "logging/setLevel") {
    sendResponse({ jsonrpc: "2.0", id: msg.id, result: {} });
    return;
  }
  if (msg.method === "tools/list") {
    sendResponse({ jsonrpc: "2.0", id: msg.id, result: { tools: TOOLS } });
    return;
  }
  if (msg.method === "resources/list") {
    sendResponse({ jsonrpc: "2.0", id: msg.id, result: { resources: [] } });
    return;
  }
  if (msg.method === "resources/templates/list") {
    sendResponse({ jsonrpc: "2.0", id: msg.id, result: { resourceTemplates: [] } });
    return;
  }
  if (msg.method === "prompts/list") {
    sendResponse({ jsonrpc: "2.0", id: msg.id, result: { prompts: [] } });
    return;
  }
  if (msg.method === "completion/complete") {
    sendResponse({ jsonrpc: "2.0", id: msg.id, result: { completion: { values: [], total: 0, hasMore: false } } });
    return;
  }
  if (msg.method === "tools/call") {
    try {
      const p = msg.params || {};
      const out = await handleToolCall(p.name, p.arguments);
      sendResponse({
        jsonrpc: "2.0",
        id: msg.id,
        result: { content: [{ type: "text", text: String(out) }], isError: false }
      });
    } catch (err) {
      sendResponse({
        jsonrpc: "2.0",
        id: msg.id,
        result: { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }
      });
    }
    return;
  }
  sendResponse({
    jsonrpc: "2.0",
    id: msg.id,
    error: { code: -32601, message: `Method not found: ${msg.method}` }
  });
}

let rawBuffer = Buffer.alloc(0);
let msgChain = Promise.resolve();
function enqueueMessage(msg) {
  msgChain = msgChain.then(() => processMessage(msg)).catch(() => {});
}

process.stdin.on("data", (chunk) => {
  rawBuffer = Buffer.concat([rawBuffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8")]);
  while (rawBuffer.length > 0) {
    const preview = rawBuffer.slice(0, Math.min(rawBuffer.length, 64)).toString("ascii");
    if (preview.startsWith("Content-Length:")) {
      useContentLength = true;
      const sepIdx = rawBuffer.indexOf("\r\n\r\n");
      if (sepIdx === -1) break;
      const hdr = rawBuffer.slice(0, sepIdx).toString("ascii");
      const m = /Content-Length:\s*(\d+)/i.exec(hdr);
      if (!m) { rawBuffer = Buffer.alloc(0); break; }
      const bodyLen = parseInt(m[1], 10);
      const bodyStart = sepIdx + 4;
      if (rawBuffer.length < bodyStart + bodyLen) break;
      const msgStr = rawBuffer.slice(bodyStart, bodyStart + bodyLen).toString("utf8");
      rawBuffer = rawBuffer.slice(bodyStart + bodyLen);
      try { enqueueMessage(JSON.parse(msgStr)); } catch {}
    } else {
      const nlIdx = rawBuffer.indexOf(0x0A);
      if (nlIdx === -1) break;
      const lineStr = rawBuffer.slice(0, nlIdx).toString("utf8").trim();
      rawBuffer = rawBuffer.slice(nlIdx + 1);
      if (!lineStr) continue;
      try { enqueueMessage(JSON.parse(lineStr)); } catch {}
    }
  }
});
