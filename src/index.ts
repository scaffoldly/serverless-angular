import path from "path";
import fs from "fs-extra";
import { WorkspaceNodeModulesArchitectHost } from "@angular-devkit/architect/node";
import { NodeJsSyncHost } from "@angular-devkit/core/node";
import { workspaces, logging } from "@angular-devkit/core";
import { Architect } from "@angular-devkit/architect";

type PluginName = "angular";
const PLUGIN_NAME: PluginName = "angular";

type BuildSystem = "angular-devkit";

type BuildMode = "development" | "production";

type PluginConfig = {
  buildSystem?: BuildSystem; // Default will be detected on node_modules
  outputDirectory?: string; // Default is .angular
  reloadHandler?: boolean; // Default is false
  configFile?: string; // Default is ./angular.json
  project?: string;
};

type ServerlessCustom = {
  esbuild?: {
    outputWorkFolder?: string;
    outputBuildFolder?: string;
  };
  angular?: PluginConfig;
  "serverless-offline"?: {
    location?: string;
  };
};

type ServerlessService = {
  service: string;
  custom?: ServerlessCustom;
  provider: {
    stage: string;
    environment?: { [key: string]: string | { Ref?: string } };
  };
  getAllFunctions: () => string[];
  getFunction: (functionName: string) => {
    name: string;
    events?: any[];
  };
};

type ServerlessConfig = {
  servicePath: string;
};

type Serverless = {
  service: ServerlessService;
  pluginManager: {
    spawn: (command: string) => Promise<void>;
  };
  config: any;
};

type Options = {
  verbose?: boolean;
  log?: ServerlessLog;
};

type ServerlessLog = ((message: string) => void) & {
  verbose: (message: string) => void;
  warning: (message: string) => void;
  error: (message: string) => void;
};

class Log {
  constructor(private options: Options) {}

  static msg = (message: string) => {
    return `[${PLUGIN_NAME}] ${message}`;
  };

  log = (message: string) => {
    if (this.options.log) {
      this.options.log(Log.msg(message));
    } else {
      console.log(Log.msg(message));
    }
  };

  verbose = (message: string) => {
    if (this.options.log) {
      this.options.log.verbose(Log.msg(message));
    }
  };

  warning = (message: string) => {
    if (this.options.log) {
      this.options.log.warning(Log.msg(message));
    } else {
      console.warn(Log.msg(message));
    }
  };

  error = (message: string) => {
    if (this.options.log) {
      this.options.log.error(Log.msg(message));
    } else {
      console.error(Log.msg(message));
    }
  };

  ngLog = (entry: logging.LogEntry) => {
    switch (entry.level) {
      case "debug":
        this.verbose(entry.message);
        break;
      case "info":
        this.log(entry.message);
        break;
      case "warn":
        this.warning(entry.message);
        break;
      case "error":
        this.error(entry.message);
        break;
      case "fatal":
        this.error(entry.message);
        break;
      default:
        this.log(entry.message);
        break;
    }
  };
}

class ServerlessAngular {
  log: Log;

  serverless: Serverless;
  serverlessConfig: ServerlessConfig;
  pluginConfig: PluginConfig;

  hooks: {
    [key: string]: () => Promise<void>;
  };

  constructor(serverless: Serverless, protected options: Options) {
    this.serverless = serverless;
    this.serverlessConfig = serverless.config;
    this.pluginConfig =
      (this.serverless.service.custom &&
        this.serverless.service.custom[PLUGIN_NAME]) ||
      {};

    this.log = new Log(options);

    this.hooks = {
      initialize: async () => {},
      "before:offline:start": async () => {
        this.log.verbose("before:offline:start");
        await this.build(
          "development",
          this.pluginConfig.reloadHandler || false
        );
      },
      "before:package:createDeploymentArtifacts": async () => {
        this.log.verbose("before:package:createDeploymentArtifacts");
        await this.build("production", false);
      },
    };
  }

  get outputPath() {
    let destination: string | undefined = undefined;

    const { esbuild } = this.serverless.service.custom || {};

    if (esbuild) {
      const outputWorkFolder = esbuild.outputWorkFolder || ".esbuild";
      const outputBuildFolder = esbuild.outputBuildFolder || ".build";
      destination = path.join(outputWorkFolder, outputBuildFolder);
    }

    if (!destination) {
      throw new Error(
        `Unknown destination. This plugin only supports serverless-esbuild.`
      );
    }

    return path.join(
      this.serverlessConfig.servicePath,
      destination,
      this.pluginConfig.outputDirectory || `.${PLUGIN_NAME}`
    );
  }

  get buildSystem(): BuildSystem {
    let requiredModules: string[] = [];
    let { buildSystem } = this.pluginConfig;

    if (!buildSystem) {
      if (
        fs.existsSync(
          path.join(
            this.serverlessConfig.servicePath,
            "node_modules",
            "@angular-devkit"
          )
        )
      ) {
        buildSystem = "angular-devkit";
      }
    }

    if (buildSystem === "angular-devkit") {
      requiredModules.push("@angular-devkit");
      requiredModules.push("@angular/compiler");
      requiredModules.push("@angular/compiler-cli");
    }

    const hasModules = requiredModules.every((module) =>
      fs.existsSync(
        path.join(this.serverlessConfig.servicePath, "node_modules", module)
      )
    );

    if (!hasModules) {
      throw new Error(
        `Could not find required modules: ${requiredModules.join(
          ", "
        )}. Please ensure they are in your project dependencies.`
      );
    }

    if (!buildSystem) {
      throw new Error(
        `Could not detect build system. Please set it using the custom.react.buildSystem property in serverless.yml.`
      );
    }

    return buildSystem;
  }

  build = async (mode: BuildMode, watch: boolean): Promise<void> => {
    if (this.buildSystem === "angular-devkit") {
      await this.buildWithAngularDevkit(mode, watch);
    }
  };

  buildWithAngularDevkit = async (
    mode: BuildMode,
    watch: boolean
  ): Promise<void> => {
    const host = new NodeJsSyncHost();

    const workspaceHost = workspaces.createWorkspaceHost(host);

    const angularJsonPath = path.join(
      this.serverlessConfig.servicePath,
      this.pluginConfig.configFile || "angular.json"
    );

    const { workspace } = await workspaces.readWorkspace(
      angularJsonPath,
      workspaceHost
    );

    const architectHost = new WorkspaceNodeModulesArchitectHost(
      workspace,
      this.serverlessConfig.servicePath
    );

    const { project: projectName } = this.pluginConfig;

    if (!projectName) {
      throw new Error(
        `custom.${PLUGIN_NAME}.project is required in serverless.yml`
      );
    }

    const architect = new Architect(architectHost);

    const logger = new logging.Logger(PLUGIN_NAME);
    logger.subscribe((entry) => {
      this.log.ngLog(entry);
    });

    const scheduleTargetRun = await architect.scheduleTarget(
      {
        configuration: mode,
        project: projectName,
        target: "build",
      },
      {
        outputPath: this.outputPath,
        progress: false,
        watch,
      },
      { logger }
    );

    if (watch) {
      scheduleTargetRun.output.subscribe((event) => {
        if (event.success) {
          return;
        }

        this.log.warning(`Compilation Error: ${event.error || ""}`);
      });

      return;
    }

    const output = await scheduleTargetRun.lastOutput;
    if (output.success) {
      return;
    }

    throw new Error(`Compilation Error: ${output.error || ""}`);
  };
}

module.exports = ServerlessAngular;
