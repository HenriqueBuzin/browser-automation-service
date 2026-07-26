const port = process.env.PORT ?? "3000";
const response = await fetch(`http://127.0.0.1:${port}/health/ready`, {
  signal: AbortSignal.timeout(2_000),
});
if (!response.ok) process.exitCode = 1;
