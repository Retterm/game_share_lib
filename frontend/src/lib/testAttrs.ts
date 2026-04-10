const ENABLE_TEST_ATTRS = process.env.NODE_ENV !== "production";

export function testAttrs(testId: string): { "data-testid": string } | Record<string, never> {
  if (!ENABLE_TEST_ATTRS) {
    return {};
  }
  return { "data-testid": testId };
}
