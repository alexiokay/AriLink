import { networkInterfaces } from "os";

export default defineEventHandler(() => {
  const nets = networkInterfaces();
  const ips: string[] = [];

  for (const name of Object.keys(nets)) {
    for (const net of nets[name]!) {
      // Skip internal (loopback) and non-IPv4
      if (!net.internal && net.family === "IPv4") {
        ips.push(net.address);
      }
    }
  }

  return { ips };
});
