import { SpooledGrpcClient } from '../src/index.js';

const API_KEY = "sk_live_vbv9kNQc2bAJgpuim6nHTaFgJAHpptTfM1s1PY9Q_VU";
const ADDRESS = "grpc.spooled.cloud:443";

async function main() {
  console.log("Creating gRPC client...");
  let start = Date.now();
  // Don't specify useTls - let it auto-detect from port 443
  const client = new SpooledGrpcClient({ address: ADDRESS, apiKey: API_KEY });
  console.log(`Client created: ${Date.now() - start}ms`);

  console.log("\n=== Enqueue job timing (without waitForReady) ===");
  for (let i = 0; i < 5; i++) {
    start = Date.now();
    try {
      const result = await client.queue.enqueue({
        queueName: `perf-test-${Date.now()}`,
        payload: { test: i }
      });
      console.log(`Enqueue #${i+1}: ${Date.now() - start}ms (job: ${result.jobId.slice(0,8)}...)`);
    } catch (e: any) {
      console.log(`Enqueue #${i+1}: ${Date.now() - start}ms ERROR: ${e.message}`);
    }
  }

  console.log("\n=== Get queue stats timing ===");
  for (let i = 0; i < 3; i++) {
    start = Date.now();
    try {
      await client.queue.getQueueStats("perf-test");
      console.log(`GetQueueStats #${i+1}: ${Date.now() - start}ms`);
    } catch (e: any) {
      console.log(`GetQueueStats #${i+1}: ${Date.now() - start}ms ERROR: ${e.message}`);
    }
  }

  client.close();
  console.log("\nDone!");
}

main().catch(console.error);
