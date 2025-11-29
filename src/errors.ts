
export class RPAError extends Error {
  constructor(message: string, public readonly code: string, public readonly details?: any) {
    super(message);
    this.name = 'RPAError';
  }
}

export class ElementNotFoundError extends RPAError {
  constructor(label: string) {
    super(
      `Could not find element with label "${label}" on the screen.`,
      'ELEMENT_NOT_FOUND',
      { label }
    );
  }
}

export class NoActionsGeneratedError extends RPAError {
  constructor() {
    super(
      'No actions were generated from the conversation. Please check if the conversation contains relevant medical information.',
      'NO_ACTIONS_GENERATED'
    );
  }
}

export class ScreenCaptureError extends RPAError {
  constructor(originalError: any) {
    super(
      'Failed to capture screen content.',
      'SCREEN_CAPTURE_FAILED',
      { originalError }
    );
  }
}
