declare module "@echogarden/fvad-wasm" {
  interface FvadModule {
    HEAP16: Int16Array;
    _malloc(size: number): number;
    _free(pointer: number): void;
    _fvad_new(): number;
    _fvad_free(pointer: number): void;
    _fvad_set_mode(pointer: number, mode: number): number;
    _fvad_set_sample_rate(pointer: number, rate: number): number;
    _fvad_process(pointer: number, samples: number, length: number): number;
  }
  export default function createFvad(options: {
    wasmBinary: Uint8Array;
    printErr: (text: string) => void;
    print: (text: string) => void;
  }): Promise<FvadModule>;
}

declare module "*.wasm" {
  const path: string;
  export default path;
}
