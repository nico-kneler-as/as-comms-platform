declare module "libmime" {
  interface LibmimeInstance {
    decodeWords(value: string): string;
  }

  const libmime: LibmimeInstance;
  export default libmime;
}
