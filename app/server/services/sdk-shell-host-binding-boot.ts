// Import this before `@cursor/sdk` so the shell slot rewrite is on disk first.
import { ensureSdkShellHostBinding } from "./sdk-shell-host-binding.js";

ensureSdkShellHostBinding();
