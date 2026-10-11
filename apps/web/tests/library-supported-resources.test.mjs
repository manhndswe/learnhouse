import { describe, expect, test } from "bun:test";
import { filterLibrary } from "../components/Dashboard/Library/LibraryHeader.tsx";
import { buildResourceUrl, buildEmbedUrl } from "../lib/library/resourceEmbed.ts";

describe("supported library resources", () => {
  const types = ["courses", "media", "communities", "boards", "playgrounds"];
  const items = types.map((resource_type) => ({
    resource_type, resource_uuid: `${resource_type}_a`, resource: { name: "Supported content" },
  }));
  const unsupported = { resource_type: "removed_resources", resource: { name: "Legacy content" } };
  const folders = [{ name: "My folder" }];

  test("All retains every supported kind and omits unsupported records", () => {
    const result = filterLibrary(folders, [...items, unsupported], "", "all");
    expect(result.visibleFolders).toEqual(folders);
    expect(result.visibleItems).toEqual(items);
  });

  test("course, media and folder filters keep their existing behavior", () => {
    expect(filterLibrary(folders, items, "", "courses").visibleItems).toEqual([items[0]]);
    expect(filterLibrary(folders, items, "", "media").visibleItems).toEqual([items[1]]);
    expect(filterLibrary(folders, items, "", "folders")).toEqual({ visibleFolders: folders, visibleItems: [] });
  });

  test("search remains case insensitive and supports media titles", () => {
    const media = { resource_type: "media", resource: { title: "Uploaded Recording" } };
    expect(filterLibrary(folders, [...items, media, unsupported], "RECORDING", "all"))
      .toEqual({ visibleFolders: [], visibleItems: [media] });
  });

  test.each([
    ["course", "course_a", "/course/a"],
    ["community", "community_a", "/community/a"],
    ["board", "board_a", "/board/a"],
    ["playground", "playground_a", "/playground/playground_a"],
  ])("%s resources keep their existing internal route", (kind, uuid, path) => {
    expect(buildResourceUrl(kind, uuid, "acme")).toEndWith(path);
  });

  test("media renders inline and unknown resources have no route", () => {
    expect(buildResourceUrl("media", "media_a", "acme")).toBeNull();
    expect(buildResourceUrl("removed_resource", "legacy_a", "acme")).toBeNull();
    expect(buildResourceUrl("course", "", "acme")).toBeNull();
  });

  test("only resources with navigation chrome need the embed query", () => {
    expect(buildEmbedUrl("board", "/board/a")).toBe("/board/a");
    expect(buildEmbedUrl("course", "/course/a")).toBe("/course/a?chrome=none");
    expect(buildEmbedUrl("community", "/community/a?view=all"))
      .toBe("/community/a?view=all&chrome=none");
  });
});
