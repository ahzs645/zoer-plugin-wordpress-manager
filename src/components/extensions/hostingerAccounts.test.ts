import { expect, test } from "bun:test";
import { alreadyConnectedAs, unloadedHostingerAccounts } from "./HostingerBrowserLogin";

test("only connected accounts bound in Zoer and not yet loaded are offered", () => {
  const accounts = [
    { id: "oc_loaded", label: "Agency", status: "connected" },
    { id: "oc_new", label: "Personal", status: "connected" },
    { id: "oc_broken", label: "Old", status: "error" },
  ];
  expect(unloadedHostingerAccounts(accounts, [{ oauthConnectionId: "oc_loaded" }, { oauthConnectionId: null }, {}])).toEqual([accounts[1]]);
});

test("reads the loaded connection a repeated Hostinger sign-in belongs to", () => {
  expect(alreadyConnectedAs("This Hostinger account is already connected as “Sparklab”. Remove that connection under Provider accounts before adding it again, or keep using it.")).toBe("Sparklab");
  expect(alreadyConnectedAs("Hostinger did not answer.")).toBeNull();
});
