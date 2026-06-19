import { describe, expect, it } from "vitest";
import { loadExplicitEnvironment } from "../src/environment";

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
