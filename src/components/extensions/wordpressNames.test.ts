import { describe, expect, test } from "bun:test";
import { extensionDisplayName, recoveryPointLabel, siteAddressHost, tidyTransferSummary } from "./wordpressNames";
import { detailSectionFor, managerSection, managerSections } from "./managerSections";

describe("extensionDisplayName", () => {
  test("keeps a real name the site reported", () => {
    expect(extensionDisplayName("Campus Manager", "campus-manager")).toBe("Campus Manager");
  });
  test("names known plugins and default themes when only the slug is reported", () => {
    expect(extensionDisplayName("updraftplus", "updraftplus")).toBe("UpdraftPlus");
    expect(extensionDisplayName("hello", "hello")).toBe("Hello Dolly");
    expect(extensionDisplayName("twentytwentyfive", "twentytwentyfive")).toBe("Twenty Twenty-Five");
    expect(extensionDisplayName("twentytwentyfive-ote-child", "twentytwentyfive-ote-child")).toBe("Twenty Twenty-Five Ote Child");
    expect(extensionDisplayName(null, "twentyten")).toBe("Twenty Ten");
  });
  test("title-cases any other slug", () => {
    expect(extensionDisplayName("static-file-pages", "static-file-pages")).toBe("Static File Pages");
    expect(extensionDisplayName("", "twentyish-theme")).toBe("Twentyish Theme");
  });
});

describe("recoveryPointLabel", () => {
  test("explains engine IDs and drops the appended timestamp", () => {
    expect(recoveryPointLabel("before-copy-e1e3ba64")).toBe("Before refreshing from live");
    expect(recoveryPointLabel("Before plugin activate 2026-10-09T17:57:07.123Z")).toBe("Before plugin activate");
    expect(recoveryPointLabel("Before plugin uninstall: akismet")).toBe("Before plugin delete: akismet");
    expect(recoveryPointLabel("Manual snapshot")).toBe("Manual snapshot");
    expect(recoveryPointLabel("")).toBe("Recovery point");
  });
});

describe("tidyTransferSummary", () => {
  test("formats byte counts and the singular file", () => {
    expect(tidyTransferSummary("1 files (45,777,127 bytes) exported")).toBe("1 file (45.8 MB) exported");
    expect(tidyTransferSummary("2034 files (94,007,105 bytes) pulled")).toBe("2034 files (94.0 MB) pulled");
    expect(tidyTransferSummary("Local export: Database")).toBe("Local export: Database");
  });
});

describe("siteAddressHost", () => {
  test("returns the host of an address with or without a scheme", () => {
    expect(siteAddressHost("http://example.ddev.site:8080/")).toBe("example.ddev.site");
    expect(siteAddressHost("overtheedge.unbc.ca")).toBe("overtheedge.unbc.ca");
    expect(siteAddressHost(null)).toBe("");
  });
});

describe("manager sections", () => {
  test("old routes open the section they were folded into", () => {
    expect(managerSection("themes")).toBe("plugins");
    expect(managerSection("updates")).toBe("history");
    expect(managerSection("connections")).toBe("overview");
    expect(managerSection("deployments")).toBe("deployments");
  });
  test("offers the scanner on local DDEV sites only", () => {
    expect(managerSections("ddev").map(section => section.id)).toContain("security");
    expect(managerSections("hostinger").map(section => section.id)).not.toContain("security");
    expect(managerSections("ddev")).toHaveLength(7);
    // Caching (public website check and hosting cache) is for live sites only.
    expect(managerSections("hostinger").map(section => section.id)).toContain("caching");
    expect(managerSections("zoer-connect").map(section => section.id)).toContain("caching");
    expect(managerSections("ddev").map(section => section.id)).not.toContain("caching");
    expect(detailSectionFor("caching")).toBeNull();
  });
  test("asks for site details only where a section shows them", () => {
    expect(detailSectionFor("themes")).toBe("themes");
    expect(detailSectionFor("plugins")).toBe("plugins");
    expect(detailSectionFor("updates")).toBeNull();
    expect(detailSectionFor("history")).toBeNull();
    expect(detailSectionFor("security")).toBeNull();
    expect(detailSectionFor("development")).toBeNull();
    expect(detailSectionFor("deployments")).toBe("deployments");
  });
});
