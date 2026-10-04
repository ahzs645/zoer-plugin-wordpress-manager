import { expect, test } from "bun:test";
import { unloadedHostingerAccounts } from "./HostingerBrowserLogin";

test("only connected accounts bound in Zoer and not yet loaded are offered", () => {
  const accounts = [
    { id: "oc_loaded", label: "Agency", status: "connected" },
    { id: "oc_new", label: "Personal", status: "connected" },
    { id: "oc_broken", label: "Old", status: "error" },
  ];
  expect(unloadedHostingerAccounts(accounts, [{ oauthConnectionId: "oc_loaded" }, { oauthConnectionId: null }, {}])).toEqual([accounts[1]]);
});
