import { describe, expect, it } from "vitest";
import { loadExplicitEnvironment, loadLangfuseEnvironment } from "../src/environment";

describe("loadExplicitEnvironment", () => {
  it("does not read an environment file unless its path is explicit", () => {
    let reads = 0;
    const environment = loadExplicitEnvironment({ DEEPSEEK_MODEL: "deepseek-chat" }, () => {
      reads += 1;
      return "DEEPSEEK_API_KEY=sk-should-not-load";
    });

    expect(reads).toBe(0);
    expect(environment.DEEPSEEK_API_KEY).toBeUndefined();
  });

  it("loads only missing values from TYPEDANCE_ENV_FILE", () => {
    const environment = loadExplicitEnvironment(
      { TYPEDANCE_ENV_FILE: "C:/config/typedance.env", DEEPSEEK_MODEL: "existing-model" },
      (path) => {
        expect(path).toBe("C:/config/typedance.env");
        return "DEEPSEEK_MODEL=file-model\nDEEPSEEK_API_KEY='sk-explicit'\n";
      },
    );

    expect(environment.DEEPSEEK_MODEL).toBe("existing-model");
    expect(environment.DEEPSEEK_API_KEY).toBe("sk-explicit");
  });
});

describe("loadLangfuseEnvironment", () => {
  const configPath = "C:/Users/test/AppData/Roaming/app.typedance.desktop/agent-host/langfuse.env";

  it("loads the installed client's quoted cloud settings without mutating the process environment", () => {
    const source = { TYPEDANCE_DATA_DIR: "C:/data" };
    const environment = loadLangfuseEnvironment(source, configPath, (path) => {
      expect(path).toBe(configPath);
      return '\uFEFF# Local monitoring\r\nLANGFUSE_ENABLED=true\r\nLANGFUSE_BASE_URL="https://us.cloud.langfuse.com"\r\nLANGFUSE_PUBLIC_KEY="pk-test"\r\nLANGFUSE_SECRET_KEY="sk-test"\r\nLANGFUSE_CAPTURE_CONTENT=false\r\nLANGFUSE_TRACING_ENVIRONMENT=production\r\n';
    });
    expect(environment).toMatchObject({
      LANGFUSE_ENABLED: "true", LANGFUSE_BASE_URL: "https://us.cloud.langfuse.com",
      LANGFUSE_PUBLIC_KEY: "pk-test", LANGFUSE_SECRET_KEY: "sk-test",
      LANGFUSE_CAPTURE_CONTENT: "false", LANGFUSE_TRACING_ENVIRONMENT: "production",
    });
    expect(source).toEqual({ TYPEDANCE_DATA_DIR: "C:/data" });
  });

  it("allows startup environment variables to override the local monitoring file", () => {
    const environment = loadLangfuseEnvironment({ LANGFUSE_ENABLED: "false", LANGFUSE_SECRET_KEY: "process-key" }, configPath,
      () => "LANGFUSE_ENABLED=true\nLANGFUSE_SECRET_KEY=file-key\nLANGFUSE_PUBLIC_KEY=pk-test\n");
    expect(environment.LANGFUSE_ENABLED).toBe("false");
    expect(environment.LANGFUSE_SECRET_KEY).toBe("process-key");
    expect(environment.LANGFUSE_PUBLIC_KEY).toBe("pk-test");
  });

  it("does not let the monitoring file change application paths or model credentials", () => {
    const environment = loadLangfuseEnvironment({}, configPath,
      () => "DEEPSEEK_API_KEY=forbidden\nTYPEDANCE_DATA_DIR=elsewhere\nAGENT_HOST_PORT=9999\nTYPEDANCE_ENV_FILE=other.env\nLANGFUSE_UNKNOWN=value\nLANGFUSE_ENABLED=true");
    expect(environment).toEqual({ LANGFUSE_ENABLED: "true" });
  });

  it("keeps monitoring optional when no per-user configuration exists", () => {
    const warnings: string[] = [];
    const environment = loadLangfuseEnvironment({}, configPath,
      () => { throw Object.assign(new Error("not found"), { code: "ENOENT" }); }, (warning) => warnings.push(warning));
    expect(environment).toEqual({});
    expect(warnings).toEqual([]);
  });

  it("does not interrupt startup or expose the underlying error when the file is unreadable", () => {
    const warnings: string[] = [];
    const environment = loadLangfuseEnvironment({ LANGFUSE_ENABLED: "false" }, configPath,
      () => { throw Object.assign(new Error("private-secret-content"), { code: "EACCES" }); }, (warning) => warnings.push(warning));
    expect(environment.LANGFUSE_ENABLED).toBe("false");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).not.toContain("private-secret-content");
  });
});
