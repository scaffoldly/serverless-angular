import path from "path";
import fs from "fs-extra";
// import { Schema } from "@angular-devkit/build-angular/src/builders/application/schema";
// import { buildApplication } from "@angular-devkit/build-angular";
// import application from "@schematics/angular/application";
// import readWorkspace from "@angular-devkit/build-angular";
// import { buildApplication } from "@angular-devkit/build-angular";
// import { createBuilder } from "@angular-devkit/architect";
// import { WorkspaceNodeModulesArchitectHost } from "@angular-devkit/architect/node";
import { NodeJsSyncHost } from "@angular-devkit/core/node";
import { workspaces } from "@angular-devkit/core";

type PluginName = "angular";
const PLUGIN_NAME: PluginName = "angular";

type BuildSystem = "angular-devkit";

type BuildMode = "development" | "production";

type PluginConfig = {
  buildSystem?: BuildSystem; // Default will be detected on node_modules
  outputDirectory?: string; // Default is .angular
  reloadHandler?: boolean; // Default is false
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
    } else {
      console.log(Log.msg(message));
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
}

class ServerlessReact {
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

    console.log("!!!! options", options);

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
    _mode: BuildMode,
    _watch: boolean
  ): Promise<void> => {
    const host = workspaces.createWorkspaceHost(new NodeJsSyncHost());
    const { workspace } = await workspaces.readWorkspace(".", host);

    const { project: projectName } = this.pluginConfig;

    if (!projectName) {
      throw new Error(
        `custom.${PLUGIN_NAME}.project is required in serverless.yml`
      );
    }

    const project = workspace.projects.get(projectName);
    if (!project) {
      throw new Error(`${projectName} does not exist`);
    }

    console.log("!!!! project", project);

    const buildTarget = project.targets.get("build");
    if (!buildTarget) {
      throw new Error("build target does not exist");
    }

    console.log("!!!! buildTarget", buildTarget);

    // buildTarget.options.optimization = true;
    // buildApplication({});
    // const vite = await import("vite");
    // const { entryPoint } = this.pluginConfig;
    // await vite.build({
    //   mode,
    //   configFile: this.pluginConfig.vite?.configFile,
    //   build: {
    //     outDir: this.outputPath,
    //     rollupOptions: {
    //       input: { app: entryPoint ? entryPoint : "./index.html" },
    //     },
    //     watch: watch ? {} : undefined,
    //     reportCompressedSize: this.options.verbose,
    //   },
    // });
  };
}

module.exports = ServerlessReact;