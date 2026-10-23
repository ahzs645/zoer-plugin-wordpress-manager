#!/usr/bin/env python3
"""Verify a real downloaded export on a plain static server, with source requests blocked.

Run this on the remote development server in an existing browser-runtime image.
It does not launch a WordPress/backend fixture or contact protected source routes.
"""
import argparse
import functools
import hashlib
import http.server
import json
import re
import tempfile
import threading
import urllib.parse
import zipfile
from pathlib import Path, PurePosixPath

from playwright.sync_api import sync_playwright


def query_path(path, values):
    query = urllib.parse.urlencode(sorted(values.items()))
    return path.rstrip("/") + "/__query/" + hashlib.sha256(("?" + query).encode()).hexdigest()[:24] + "/"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--zip", required=True)
    parser.add_argument("--fixture")
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--base-path", default="/")
    parser.add_argument("--case", choices=("loops", "enhanced", "site"), default="loops")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    artifact = Path(args.zip)
    if args.case != "site" and not args.fixture:
        parser.error("--fixture is required for query-loop cases")
    fixture = json.loads(Path(args.fixture).read_text()) if args.fixture else {}
    base = "/" + args.base_path.strip("/") + "/" if args.base_path.strip("/") else "/"
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    (output / "failure.json").unlink(missing_ok=True)
    actual_hash = hashlib.sha256(artifact.read_bytes()).hexdigest()
    if actual_hash != args.sha256:
        raise AssertionError("Downloaded ZIP SHA-256 differs from the saved export receipt")
    enhanced = args.case == "enhanced"
    loop_path = "/" if args.case == "site" else urllib.parse.urlsplit(fixture["routes"]["enhanced" if enhanced else "loops"]).path
    first_query = "query-17-page" if enhanced else "query-7-page"
    routes = {
        "initial": loop_path,
        "loop7Page2": query_path(loop_path, {first_query: "2"}),
        "combined": query_path(loop_path, {first_query: "3"} if enhanced else {"query-7-page": "2", "query-9-page": "3"}),
    }
    results = {"sha256": actual_hash, "basePath": base, "checks": [], "blockedRequests": [], "errors": []}
    with tempfile.TemporaryDirectory(prefix="zoer-static-artifact-") as scratch:
        root = Path(scratch)
        destination = root / base.strip("/")
        destination.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(artifact) as archive:
            seen = set()
            for entry in archive.infolist():
                name = PurePosixPath(entry.filename)
                if name.is_absolute() or ".." in name.parts or "\\" in entry.filename:
                    raise AssertionError("Unsafe archive path")
                if entry.filename.lower() in seen:
                    raise AssertionError("Case-colliding archive paths")
                seen.add(entry.filename.lower())
                if (entry.external_attr >> 16) & 0o170000 == 0o120000:
                    raise AssertionError("Archive contains a symlink")
            if archive.testzip():
                raise AssertionError("Archive entry CRC failed")
            archive.extractall(destination)
        if not (destination / "index.html").is_file():
            raise AssertionError("No root index.html in exported artifact")
        if not (destination / loop_path.lstrip("/") / "index.html").is_file():
            # A single selected-page export promotes its initial rendering to the
            # entry point so it can open directly in Content Modules.
            routes["initial"] = "/"

        class QuietHandler(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *_args):
                pass

        handler = functools.partial(QuietHandler, directory=str(root))
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        origin = "http://127.0.0.1:" + str(server.server_address[1])
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as browser_api:
                browser = browser_api.chromium.launch(headless=True, args=["--no-sandbox"])
                for width, height, suffix in ((1440, 1000, "desktop"), (390, 844, "phone")):
                    context = browser.new_context(viewport={"width": width, "height": height})
                    context.route("**/*", lambda route: route.continue_() if route.request.url.startswith(origin + "/") or route.request.url.startswith(("data:", "blob:")) else (results["blockedRequests"].append(route.request.url), route.abort())[1])
                    page = context.new_page()
                    page.on("pageerror", lambda error: results["errors"].append(str(error)))
                    page.on("response", lambda response: results["errors"].append(str(response.status) + " " + response.url) if response.status >= 400 else None)

                    def visit(name):
                        response = page.goto(origin + base.rstrip("/") + routes[name], wait_until="networkidle")
                        assert response and response.status == 200, "Static route unavailable: " + name
                        return page.locator(".wp-block-query").evaluate_all("nodes => nodes.map(node => Array.from(node.querySelectorAll('.wp-block-post-title')).map(title => title.textContent.trim()))")

                    initial = visit("initial")
                    if args.case == "site":
                        assert page.locator("body").inner_text().strip(), "The clean site has no visible content"
                        assert "Static fixture post" not in page.locator("body").inner_text(), "Disposable fixture content remains"
                        if suffix == "phone":
                            menu = page.get_by_role("button", name="Open menu", exact=True)
                            if menu.count() and menu.first.is_visible():
                                menu.first.click()
                                close = page.get_by_role("button", name="Close menu", exact=True).first
                                assert close.is_visible(), "WordPress mobile menu did not open independently"
                                close.click()
                        page.screenshot(path=str(output / (suffix + "-initial.png")), full_page=True)
                        if suffix == "phone":
                            menu = page.get_by_role("button", name="Open menu", exact=True)
                            if menu.count() and menu.first.is_visible():
                                menu.first.click()
                        internal = page.locator("a[href]").evaluate_all("nodes => nodes.map((node, index) => ({node, index})).filter(({node}) => node.getClientRects().length && new URL(node.href).origin === location.origin && new URL(node.href).pathname !== location.pathname && !node.href.includes('#')).map(({node, index}) => ({href: node.href, index}))")
                        assert internal, "The clean selected export has no visible internal page link"
                        page.locator("a[href]").nth(internal[0]["index"]).click()
                        page.wait_for_load_state("networkidle")
                        assert page.url.startswith(origin + "/")
                        assert page.reload(wait_until="networkidle").status == 200
                        page.go_back(wait_until="networkidle")
                        results["checks"].append({"viewport": suffix, "case": "site", "content": True, "internalNavigation": True, "reload": True})
                        context.close()
                        continue
                    assert initial[0] == fixture["expectedLoopTitles"]["page1Loop7"], initial
                    if suffix == "phone":
                        menu = page.get_by_role("button", name="Open menu", exact=True)
                        if menu.count() and menu.first.is_visible():
                            menu.first.click()
                            close = page.get_by_role("button", name="Close menu", exact=True).first
                            assert close.is_visible(), "WordPress mobile menu did not open independently"
                            close.click()
                    if not enhanced:
                        page.get_by_role("button", name="Test static module", exact=True).click()
                        assert page.locator("#static-fixture-result").inner_text() == "Static module interaction works"
                        border = page.locator(".zoer-static-fixture").evaluate("node => getComputedStyle(node).borderTopColor")
                        assert border == "rgb(37, 99, 235)", border
                        images = page.locator(".zoer-static-fixture img").evaluate_all("nodes => nodes.every(node => node.complete && node.naturalWidth > 0)")
                        assert images, "Fixture image/srcset dependency failed"
                    page.screenshot(path=str(output / (suffix + "-initial.png")), full_page=True)
                    page.locator(".wp-block-query").first.locator(".wp-block-query-pagination-next").click()
                    page.wait_for_load_state("networkidle")
                    clicked = [title.strip() for title in page.locator(".wp-block-query").first.locator(".wp-block-post-title").all_text_contents()]
                    assert clicked == fixture["expectedLoopTitles"]["page2Loop7"], clicked
                    assert "__query/" in page.url, "The pagination link did not use its static route"
                    second = visit("loop7Page2")
                    assert second[0] == fixture["expectedLoopTitles"]["page2Loop7"], second
                    assert page.reload(wait_until="networkidle").status == 200
                    combined = visit("combined")
                    if enhanced:
                        assert combined[0] == ["Static fixture post 5", "Static fixture post 6"], combined
                    else:
                        assert combined[0] == fixture["expectedLoopTitles"]["page2Loop7"], combined
                        assert combined[1] == fixture["expectedLoopTitles"]["page3Loop9"], combined
                    page.screenshot(path=str(output / (suffix + "-combined.png")), full_page=True)
                    page.go_back(wait_until="networkidle")
                    assert [title.strip() for title in page.locator(".wp-block-query").first.locator(".wp-block-post-title").all_text_contents()] == fixture["expectedLoopTitles"]["page2Loop7"]
                    grid = []
                    if not enhanced:
                        for first in range(1, 4):
                            for second in range(1, 4):
                                name = "grid-" + str(first) + "-" + str(second)
                                routes[name] = query_path(loop_path, {"query-7-page": str(first), "query-9-page": str(second)})
                                titles = visit(name)
                                expected_first = ["Static fixture post " + str(2 * first - 1), "Static fixture post " + str(2 * first)]
                                expected_second = ["Static fixture post " + str(8 - 2 * second), "Static fixture post " + str(7 - 2 * second)]
                                assert titles[0] == expected_first and titles[1] == expected_second, (name, titles)
                                grid.append({"query7": first, "query9": second, "titles": titles})
                    results["checks"].append({"viewport": suffix, "case": args.case, "queryPages": routes, "module": not enhanced, "cssImport": not enhanced, "images": not enhanced, "paginationClick": True, "reload": True, "back": True, "combinationGrid": grid})
                    context.close()
                browser.close()
        finally:
            server.shutdown()
            server.server_close()
    results["blockedRequests"] = sorted(set(results["blockedRequests"]))
    results["errors"] = sorted(set(results["errors"]))
    (output / "report.json").write_text(json.dumps(results, indent=2) + "\n")
    print(json.dumps(results, indent=2))
    if results["blockedRequests"] or results["errors"]:
        raise AssertionError("The static artifact made unavailable requests or raised browser errors")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        import sys
        import traceback
        if "--output" in sys.argv:
            failure_output = Path(sys.argv[sys.argv.index("--output") + 1])
            failure_output.mkdir(parents=True, exist_ok=True)
            (failure_output / "failure.json").write_text(json.dumps({"error": str(error), "traceback": traceback.format_exc()}, indent=2) + "\n")
        raise
