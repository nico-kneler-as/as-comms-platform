declare module "@anthropic-ai/sdk" {
  export interface AnthropicMessageTextBlock {
    readonly type: "text";
    readonly text: string;
  }

  export interface AnthropicMessageOtherBlock {
    readonly type: string;
  }

  export interface AnthropicMessageResponse {
    readonly content: readonly (
      | AnthropicMessageTextBlock
      | AnthropicMessageOtherBlock
    )[];
    readonly usage?: {
      readonly input_tokens?: number;
      readonly output_tokens?: number;
    };
    readonly stop_reason?: string | null;
    readonly model?: string;
  }

  export interface AnthropicMessagesApi {
    create(
      input: Record<string, unknown>,
      options?: { readonly signal?: AbortSignal },
    ): Promise<AnthropicMessageResponse>;
  }

  export default class Anthropic {
    constructor(input: { readonly apiKey: string });

    readonly messages: AnthropicMessagesApi;
  }
}
