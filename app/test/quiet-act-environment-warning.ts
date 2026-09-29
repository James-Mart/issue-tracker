// React logs "The current testing environment is not configured to support
// act(...)" plus a full component stack on every act() call in a worker that
// has not set IS_REACT_ACT_ENVIRONMENT. It says nothing about the test, and at
// ~13k copies per run it buries real failures. Only that message is dropped;
// every other console.error still prints.
const ACT_ENVIRONMENT_WARNING =
  "Warning: The current testing environment is not configured to support act(...)";

const originalError = console.error;
console.error = (...args: unknown[]) => {
  const [first] = args;
  if (typeof first === "string" && first.startsWith(ACT_ENVIRONMENT_WARNING)) return;
  originalError(...args);
};
