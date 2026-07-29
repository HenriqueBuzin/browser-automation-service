import type {
  AutomationBrowser,
  AutomationAdapter,
  AutomationJob,
  AutomationStep,
} from "../contracts/job-contract.js";
import type { AdapterCapabilityManifest } from "../contracts/adapter-contract.js";

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

export type CapabilityManifest = AdapterCapabilityManifest;

export type ExecutionPlan = {
  browser: AutomationBrowser;
  adapter: AutomationAdapter;
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
    const availableAdapters = [
      ...new Set(this.capabilities.map((capability) => capability.adapter)),
    ];
    if (!job.adapters && !job.browsers) {
      return this.capabilities.map((capability) => this.#plan(job, capability));
    }

    const adapters = job.adapters ?? availableAdapters;
    if (!job.browsers) {
      return this.capabilities
        .filter((capability) => adapters.includes(capability.adapter))
        .map((capability) => this.#plan(job, capability));
    }

    const browsers = job.browsers;
    return adapters.flatMap((adapter) =>
      browsers.map((browser) => {
        const capability = this.capabilities.find(
          (candidate) => candidate.adapter === adapter && candidate.browser === browser,
        );
        return capability
          ? this.#plan(job, capability)
          : {
              browser,
              adapter,
              reason: `${adapter} does not support ${browser} in this deployment`,
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
          adapter: capability.adapter,
          reason: `${capability.adapter}/${capability.browser} does not support '${unsupported.action}'`,
          supported: false,
        }
      : {
          browser: capability.browser,
          adapter: capability.adapter,
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
