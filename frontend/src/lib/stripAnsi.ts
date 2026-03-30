export function stripAnsi(input: string): string {
  if (!input) return ''
  return input
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007]*(\u0007|\u001b\\)/g, '')
    .replace(/\u001b[@-_]/g, '')
}
