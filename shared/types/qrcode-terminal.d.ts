declare module 'qrcode-terminal' {
  export function generate(text: string, opts?: { small: boolean }): void;
  export default { generate };
}
