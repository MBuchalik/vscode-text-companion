import { Result } from 'micro-result';
import { Configuration, OpenAIApi } from 'openai';

/**
 * The user needs to select at least a few words, otherwise the result might include dummy text or the like.
 */
const MIN_TEXT_LENGTH = 20;
/**
 * The maximum number of characters in the text the user has selected.
 * It would probably be better to actually tokenize the text and to count the number of tokens,
 * but this should be fine for now.
 */
const MAX_TEXT_LENGTH = 2000;
/**
 * The maximum number of tokens in the response.
 */
const MAX_RESPONSE_TOKENS = 1000;

export enum TextCommand {
  ShortenText,
  SimplifyText,
  FixGrammarIssues,
}

interface APIRequestParams {
  command: TextCommand;
  text: string;
  apiKey: string;
  abortController: AbortController;
}
export type APIRequestResult = Result<string, string | undefined>;

export async function performOpenAIApiRequest(
  params: APIRequestParams,
): Promise<APIRequestResult> {
  if (params.text.trim().length < MIN_TEXT_LENGTH) {
    return {
      success: false,
      error: 'The selected text is too short',
    };
  }
  if (params.text.length > MAX_TEXT_LENGTH) {
    return {
      success: false,
      error: 'The selected text is too long',
    };
  }

  const configuration = new Configuration({
    apiKey: params.apiKey,
  });
  const api = new OpenAIApi(configuration);

  const theCommand = getCommandText(params.command);

  const DIVIDER = '"""';
  const textWithoutDivider = params.text.replaceAll(DIVIDER, '');

  // See https://help.openai.com/en/articles/6654000-best-practices-for-prompt-engineering-with-openai-api for some best practices regarding the prompt.
  const fullPrompt = `${theCommand}\n\nText: ${DIVIDER}\n${textWithoutDivider}\n${DIVIDER}\n\n`;

  try {
    const completion = await api.createCompletion(
      {
        model: 'text-davinci-003',
        prompt: fullPrompt,
        max_tokens: MAX_RESPONSE_TOKENS,
        temperature: 0.9,
        top_p: 0.5,
        frequency_penalty: 0.5,
        presence_penalty: 0,
      },
      {
        signal: params.abortController.signal,
      },
    );

    const text = completion.data.choices[0]?.text;

    if (text === undefined || text.trim().length < 1) {
      return {
        success: false,
        error: 'An unknown error has occurred',
      };
    }

    // Enhance the result text.

    const splitText = text.split('\n');

    // We have an empty line at the beginning? Remove it!
    if (splitText[0]?.trim() === '') {
      splitText.splice(0, 1);
    }
    // We have an empty line at the end? Remove it!
    if (splitText.at(-1)?.trim() === '') {
      splitText.splice(-1, 1);
    }

    // If, for some reason, the response contains the divider, we want to omit it from the result.
    const filteredSplitText = splitText.filter((line) => line !== DIVIDER);
    const filteredText = filteredSplitText.join('\n');

    return {
      success: true,
      data: filteredText,
    };
  } catch (error) {
    if (
      typeof error === 'object' &&
      error != null &&
      (error as Record<string, unknown>).message === 'canceled'
    ) {
      return {
        success: false,
      };
    }

    return {
      success: false,
      error: 'An unknown error has occurred',
    };
  }
}

function getCommandText(command: TextCommand): string {
  switch (command) {
    case TextCommand.ShortenText:
      return 'Shorten the following text. Keep the formatting.';
    case TextCommand.SimplifyText:
      return 'Make the following snippet easier to understand. Keep the formatting.';
    case TextCommand.FixGrammarIssues:
      return 'Fix grammar and spelling issues in the following snippet. Keep the formatting. Change as few words as possible.';
  }
}
