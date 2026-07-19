export const MarkdownRenderer = {
  async render(_app: unknown, markdown: string, element: HTMLElement): Promise<void> {
    element.textContent = markdown;
  }
};
