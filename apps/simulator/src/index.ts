import { parseCli, UsageError, usageText } from './cli.js';
import { formatReport, runSimulation } from './engine.js';

function main(argv: string[]): number {
  try {
    const result = runSimulation(parseCli(argv));
    process.stdout.write(formatReport(result));
    return result.ok ? 0 : 1;
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n${usageText()}\n`);
      return 2;
    }
    throw error;
  }
}

process.exitCode = main(process.argv.slice(2));
