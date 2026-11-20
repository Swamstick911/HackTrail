const listeners = new Map<string, (event: any) => void>();
export const commandsByName = new Map<string, (...args: any[]) => any>();
function subscribe(name: string) {
  return (listener: (event: any) => void) => {
    listeners.set(name, listener);
    return { dispose: () => listeners.delete(name) };
  };
}
export function emit(name: string, event: unknown) {
  listeners.get(name)?.(event);
}
export function resetEditor() {
  listeners.clear();
  commandsByName.clear();
  window.state.focused = true;
}
export const workspace = {
  isTrusted: true,
  workspaceFolders: [{}],
  getWorkspaceFolder: () => ({}),
};
export const window = {
  state: { focused: true },
  activeTextEditor: { document: { uri: 'file:///private/project/code.ts' } },
  createStatusBarItem: () => ({ text: '', tooltip: '', command: '', show() {}, dispose() {} }),
  onDidChangeWindowState: subscribe('focus'),
  onDidChangeActiveTextEditor: subscribe('editor'),
  onDidChangeTextEditorSelection: subscribe('selection'),
  showInformationMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  showInputBox: async () => undefined,
  showQuickPick: async () => undefined,
};
export const env = { appName: 'Visual Studio Code', openExternal: async () => true };
export const commands = {
  registerCommand(name: string, action: (...args: any[]) => any) {
    commandsByName.set(name, action);
    return { dispose: () => commandsByName.delete(name) };
  },
  executeCommand(name: string) {
    return commandsByName.get(name)?.();
  },
};
export const Uri = { parse: (value: string) => value };
export const StatusBarAlignment = { Left: 1 };
export const TextEditorSelectionChangeKind = { Keyboard: 1, Mouse: 2, Command: 3 };
