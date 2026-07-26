import type {
  AutomationBrowser,
  AutomationEngine,
  AutomationJob,
  AutomationStep,
} from "../contracts/job-contract.js";

export const portableActions: AutomationStep["action"][] = [
  "assert",
  "back",
  "check",
  "click",
  "extract",
  "fill",
  "focus",
  "forward",
  "goto",
  "hover",
  "press",
  "reload",
  "screenshot",
  "scroll",
  "select",
  "setViewport",
  "type",
  "uncheck",
  "wait",
  "waitForSelector",
  "waitForUrl",
];

export type CapabilityManifest = {
  actions: readonly AutomationStep["action"][];
  browser: AutomationBrowser;
  driver: AutomationEngine;
};

export type ExecutionPlan = {
  browser: AutomationBrowser;
  driver: AutomationEngine;
  reason?: string;
  supported: boolean;
};

export class JobCompiler {
  public constructor(private readonly capabilities: readonly CapabilityManifest[]) {}

  public manifests(): readonly CapabilityManifest[] {
    return this.capabilities;
  }

  public compile(job: AutomationJob): ExecutionPlan[] {
    validateNavigationProtocols(job.steps);
    const availableDrivers = [...new Set(this.capabilities.map((capability) => capability.driver))];
    if (!job.drivers && !job.browsers) {
      return this.capabilities.map((capability) => this.#plan(job, capability));
    }

    const drivers = job.drivers ?? availableDrivers;
    if (!job.browsers) {
      return this.capabilities
        .filter((capability) => drivers.includes(capability.driver))
        .map((capability) => this.#plan(job, capability));
    }

    const browsers = job.browsers;
    return drivers.flatMap((driver) =>
      browsers.map((browser) => {
        const capability = this.capabilities.find(
          (candidate) => candidate.driver === driver && candidate.browser === browser,
        );
        return capability
          ? this.#plan(job, capability)
          : {
              browser,
              driver,
              reason: `${driver} does not support ${browser} in this deployment`,
              supported: false,
            };
      }),
    );
  }

  #plan(job: AutomationJob, capability: CapabilityManifest): ExecutionPlan {
    const unsupported = job.steps.find((step) => !capability.actions.includes(step.action));
    return unsupported
      ? {
          browser: capability.browser,
          driver: capability.driver,
          reason: `${capability.driver}/${capability.browser} does not support '${unsupported.action}'`,
          supported: false,
        }
      : {
          browser: capability.browser,
          driver: capability.driver,
          supported: true,
        };
  }
}

function validateNavigationProtocols(steps: AutomationStep[]): void {
  for (const step of steps) {
    if (step.action !== "goto") continue;
    const protocol = new URL(step.url).protocol;
    if (!["data:", "http:", "https:"].includes(protocol)) {
      throw new TypeError("goto only supports http, https and data URLs");
    }
  }
}
