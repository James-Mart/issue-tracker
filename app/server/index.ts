import { createApp } from "./app.js";
import { listenPort } from "./config.js";

const app = createApp();

app.listen(listenPort, () => {
  console.log(
    `issue-tracker server listening on http://localhost:${listenPort}`,
  );
});
