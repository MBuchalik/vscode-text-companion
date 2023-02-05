import * as vscode from 'vscode';

import {
  APIRequestResult,
  TextCommand,
  performOpenAIApiRequest,
} from './openai';

const OPENAI_API_KEY__SECRET_STORAGE_KEY = 'openai-api-key';

interface CustomExtensionContext {
  abortControllerForCurrentlyRunningRequest: AbortController | undefined;
}

export function activate(context: vscode.ExtensionContext): void {
  const customExtensionContext: CustomExtensionContext = {
    abortControllerForCurrentlyRunningRequest: undefined,
  };

  buildTextCommands(context, customExtensionContext);

  buildSetAPIKeyCommand(context);
  buildDeleteAPIKeyCommand(context);
}

function buildSetAPIKeyCommand(context: vscode.ExtensionContext): void {
  const command = vscode.commands.registerCommand(
    'text-companion.set-openai-api-key',
    async () => {
      const inputResult = await vscode.window.showInputBox({
        password: true,
        title: 'OpenAI API Key',
      });

      if (inputResult === undefined || inputResult.trim().length < 1) {
        return;
      }

      await context.secrets.store(
        OPENAI_API_KEY__SECRET_STORAGE_KEY,
        inputResult,
      );

      void vscode.window.showInformationMessage('The API Key has been set');
    },
  );

  context.subscriptions.push(command);
}

function buildDeleteAPIKeyCommand(context: vscode.ExtensionContext): void {
  const command = vscode.commands.registerCommand(
    'text-companion.delete-openai-api-key',
    async () => {
      const ANSWER_YES = 'Yes';
      const ANSWER_NO = 'No';

      const result = await vscode.window.showInformationMessage(
        'Do you really want to delete the OpenAI API Key?',
        ANSWER_YES,
        ANSWER_NO,
      );

      if (result !== ANSWER_YES) {
        return;
      }

      await context.secrets.delete(OPENAI_API_KEY__SECRET_STORAGE_KEY);

      void vscode.window.showInformationMessage('The API Key has been deleted');
    },
  );

  context.subscriptions.push(command);
}

function buildTextCommands(
  context: vscode.ExtensionContext,
  customExtensionContext: CustomExtensionContext,
): void {
  interface SingleCommand {
    vscodeCommand: string;
    correspondingTextCommand: TextCommand;
  }
  const ALL_COMMANDS: SingleCommand[] = [
    {
      vscodeCommand: 'text-companion.shorten-text',
      correspondingTextCommand: TextCommand.ShortenText,
    },
    {
      vscodeCommand: 'text-companion.simplify-text',
      correspondingTextCommand: TextCommand.SimplifyText,
    },
    {
      vscodeCommand: 'text-companion.fix-grammar-issues',
      correspondingTextCommand: TextCommand.FixGrammarIssues,
    },
  ];

  for (const singleCommand of ALL_COMMANDS) {
    const disposable = vscode.commands.registerCommand(
      singleCommand.vscodeCommand,
      () =>
        handleTextCommand(
          context,
          customExtensionContext,
          singleCommand.correspondingTextCommand,
        ),
    );

    context.subscriptions.push(disposable);
  }
}

async function handleTextCommand(
  context: vscode.ExtensionContext,
  customExtensionContext: CustomExtensionContext,
  command: TextCommand,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    void vscode.window.showErrorMessage('Found no text editor');
    return;
  }

  const document = editor.document;
  const selection = editor.selection;
  const selectedText = document.getText(editor.selection);

  if (editor.selection.isEmpty) {
    void vscode.window.showErrorMessage('No text selected');
    return;
  }

  let title: string;
  switch (command) {
    case TextCommand.ShortenText:
      title = 'Shortening the text';
      break;
    case TextCommand.SimplifyText:
      title = 'Simplifying the text';
      break;
    case TextCommand.FixGrammarIssues:
      title = 'Fixing grammar and spelling issues';
      break;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: title,
      cancellable: true,
    },
    async (_progress, token) => {
      context.subscriptions.push(
        token.onCancellationRequested(() => {
          customExtensionContext.abortControllerForCurrentlyRunningRequest?.abort();
        }),
      );
      const textShorteningResult = await triggerAPIRequest(
        context,
        customExtensionContext,
        command,
        selectedText,
      );
      if (!textShorteningResult.success) {
        if (textShorteningResult.error !== undefined) {
          void vscode.window.showErrorMessage(textShorteningResult.error);
        }

        return;
      }

      await editor.edit((editBuilder) => {
        editBuilder.replace(selection, textShorteningResult.data);
      });
    },
  );
}

async function triggerAPIRequest(
  context: vscode.ExtensionContext,
  customExtensionContext: CustomExtensionContext,
  command: TextCommand,
  text: string,
): Promise<APIRequestResult> {
  const apiKey = await context.secrets.get(OPENAI_API_KEY__SECRET_STORAGE_KEY);
  if (apiKey === undefined) {
    return {
      success: false,
      error:
        'You have not configured your API Key yet. Run command "text-companion.set-openai-api-key" to set an API key.',
    };
  }

  customExtensionContext.abortControllerForCurrentlyRunningRequest?.abort();

  const abortController = new AbortController();
  customExtensionContext.abortControllerForCurrentlyRunningRequest =
    abortController;

  const result = await performOpenAIApiRequest({
    abortController: abortController,
    apiKey: apiKey,
    command: command,
    text: text,
  });

  // eslint-disable-next-line require-atomic-updates
  customExtensionContext.abortControllerForCurrentlyRunningRequest = undefined;

  return result;
}
