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
export async function openEditorUri(uri: { path: string; query: string }) {
  const handler = listeners.get('uriHandler') as unknown as {
    handleUri(uri: unknown): Promise<void>;
  };
  await handler.handleUri(uri);
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
  showInformationMessage: async (..._args: unknown[]): Promise<string | undefined> => undefined,
  showErrorMessage: async (..._args: unknown[]) => undefined,
  showInputBox: async () => undefined,
  showQuickPick: async () => undefined,
  showWorkspaceFolderPick: async () => undefined,
  showWarningMessage: async (..._args: unknown[]) => undefined,
  registerUriHandler: subscribe('uriHandler'),
  withProgress: async (
    _options: unknown,
    operation: (progress: { report: (value: unknown) => void }) => unknown,
  ) => operation({ report() {} }),
};
export const env = {
  appName: 'Visual Studio Code',
  openExternal: async () => true,
  asExternalUri: async (uri: unknown) => uri,
};
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
export const ProgressLocation = { Notification: 15 };
export const TextEditorSelectionChangeKind = { Keyboard: 1, Mouse: 2, Command: 3 };
