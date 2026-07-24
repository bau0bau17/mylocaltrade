import { describe, it, expect } from "vitest";
import { detectContactInfo } from "./content-filter";

describe("detectContactInfo — phone numbers", () => {
  it("detects a plain UK mobile number", () => {
    expect(detectContactInfo("call me on 07911123456")).toBe("phone");
  });

  it("detects a number with spaces", () => {
    expect(detectContactInfo("ring 07911 123 456 anytime")).toBe("phone");
  });

  it("detects a number with dashes", () => {
    expect(detectContactInfo("07911-123-456")).toBe("phone");
  });

  it("detects slash-separated numbers (obfuscation)", () => {
    expect(detectContactInfo("07/1234/56789")).toBe("phone");
  });

  it("detects a number with parentheses around area code", () => {
    expect(detectContactInfo("(07911) 123456")).toBe("phone");
  });

  it("detects a number with dots as separators", () => {
    expect(detectContactInfo("07911.123.456")).toBe("phone");
  });

  it("returns null for a short digit sequence (not a phone)", () => {
    expect(detectContactInfo("order number 12345")).toBeNull();
  });
});

describe("detectContactInfo — email addresses", () => {
  it("detects a plain email address", () => {
    expect(detectContactInfo("contact me at alice@example.com")).toBe("email");
  });

  it("detects (at) obfuscation", () => {
    expect(detectContactInfo("alice(at)example.com")).toBe("email");
  });

  it("detects [at] obfuscation", () => {
    expect(detectContactInfo("alice[at]example.com")).toBe("email");
  });

  it("detects ' at ' word obfuscation", () => {
    expect(detectContactInfo("alice at example.com")).toBe("email");
  });

  it("detects multi-space ' at ' obfuscation", () => {
    expect(detectContactInfo("alice   at   example.com")).toBe("email");
  });

  it("detects [ at ] obfuscation (spaces inside brackets)", () => {
    expect(detectContactInfo("alice [ at ] example.com")).toBe("email");
  });

  it("detects ( at ) obfuscation (spaces inside parens)", () => {
    expect(detectContactInfo("alice ( at ) example.com")).toBe("email");
  });

  it("detects combined at+dot obfuscation", () => {
    expect(detectContactInfo("alice at example dot com")).toBe("email");
  });

  it("detects combined multi-space at+dot obfuscation", () => {
    expect(detectContactInfo("alice   at   example   dot   com")).toBe("email");
  });

  it("detects [ at ] [ dot ] obfuscation", () => {
    expect(detectContactInfo("alice [ at ] example [ dot ] com")).toBe("email");
  });

  it("detects ( at ) ( dot ) obfuscation", () => {
    expect(detectContactInfo("alice ( at ) example ( dot ) com")).toBe("email");
  });
});

describe("detectContactInfo — URLs", () => {
  it("detects a plain https URL", () => {
    expect(detectContactInfo("visit https://example.com")).toBe("url");
  });

  it("detects a www URL", () => {
    expect(detectContactInfo("check out www.example.com")).toBe("url");
  });

  it("detects a bare domain with common TLD", () => {
    expect(detectContactInfo("visit mysite.co.uk for details")).toBe("url");
  });

  it("detects [dot] obfuscation in domain", () => {
    expect(detectContactInfo("example[dot]com")).toBe("url");
  });

  it("detects (dot) obfuscation in domain", () => {
    expect(detectContactInfo("example(dot)com")).toBe("url");
  });

  it("detects ' dot ' word obfuscation in domain", () => {
    expect(detectContactInfo("example dot com")).toBe("url");
  });

  it("detects [ dot ] with inner spaces", () => {
    expect(detectContactInfo("example [ dot ] com")).toBe("url");
  });
});

describe("detectContactInfo — clean text", () => {
  it("returns null for ordinary prose", () => {
    expect(detectContactInfo("I can come round on Tuesday to have a look")).toBeNull();
  });

  it("returns null for text mentioning price", () => {
    expect(detectContactInfo("The job will cost around £450 including parts")).toBeNull();
  });

  it("returns null for an address without contact details", () => {
    expect(detectContactInfo("I am based in London near the city centre")).toBeNull();
  });
});
