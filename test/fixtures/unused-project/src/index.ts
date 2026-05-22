// Uses chalk (declared) and express (NOT declared -> missing).
// Does NOT use lodash or left-pad (declared -> unused).
import chalk from "chalk";
import express from "express";
import { readFile } from "node:fs/promises"; // builtin, should be ignored

const app = express();

export function greet(name: string): string {
  return chalk.green(`Hello, ${name}!`);
}

export async function load(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export default app;
