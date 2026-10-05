import { expect, test } from "bun:test";
import { parseLocalInventory, tablePrefix } from "./inventory";
import { tableItems } from "../../components/extensions/wordpressTransfer/DatabasePanel";

test("a local DDEV site's WP-CLI output becomes the transfer panels' inventory", () => {
  const inventory = parseLocalInventory({
    tables: "wp_commentmeta\nwp_options\nwp_posts\nwp_postmeta\nwp_odd-name\nwp_wc_orders\n",
    plugins: JSON.stringify([{ name: "akismet", title: "Akismet", status: "active", version: "5.3" }, { name: "hello", title: "Hello Dolly", status: "inactive", version: "1.7" }, { name: "object-cache", status: "dropin" }, { name: "mu", status: "must-use" }]),
    themes: JSON.stringify([{ name: "twentytwentyfour", title: "Twenty Twenty-Four", status: "active", version: "1.2" }, { name: "twentytwentythree", status: "inactive" }]),
  });
  expect(inventory.wordpress).toEqual({ prefix: "wp_" });
  expect(tableItems(inventory).map(item => [item.value, !!item.disabled])).toEqual([["commentmeta", false], ["options", false], ["posts", false], ["postmeta", false], ["odd-name", true], ["wc_orders", false]]);
  expect(inventory.plugins).toEqual([{ slug: "akismet", name: "Akismet", version: "5.3", active: true }, { slug: "hello", name: "Hello Dolly", version: "1.7", active: false }]);
  expect(inventory.themes?.map(t => [t.slug, t.active])).toEqual([["twentytwentyfour", true], ["twentytwentythree", false]]);
});

test("unreadable output degrades to an empty inventory instead of failing", () => {
  expect(parseLocalInventory({ tables: "Error: not installed", plugins: "{", themes: "" })).toEqual({ database: { tables: [] }, plugins: [], themes: [] });
  expect(tablePrefix(["shop_options", "shop_posts", "shop_x_options", "wp_options"])).toBe("shop_");
  expect(tablePrefix(["wp_users"])).toBeNull();
});
