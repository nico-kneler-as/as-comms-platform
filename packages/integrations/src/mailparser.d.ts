declare module "mailparser" {
  export interface SimpleParserOptions {
    readonly skipImageLinks?: boolean;
    readonly skipTextToHtml?: boolean;
  }

  export function simpleParser(
    source: string | Buffer,
    options?: SimpleParserOptions,
  ): Promise<{
    text?: string | null;
    html?: string | false | null;
  }>;
}
