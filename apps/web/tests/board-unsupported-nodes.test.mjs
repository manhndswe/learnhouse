import { describe, expect, test } from "bun:test";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { initProseMirrorDoc } from "y-prosemirror";
import * as Y from "yjs";
import { BoardCardExtension } from "../components/Dashboard/Boards/Extensions/BoardCard.ts";

describe("historical board documents", () => {
  test("collaboration skips unsupported blocks while preserving remaining cards", () => {
    const schema = getSchema([StarterKit, BoardCardExtension]);
    const ydoc = new Y.Doc();
    const fragment = ydoc.getXmlFragment("default");
    const card = new Y.XmlElement("boardCard");
    card.setAttribute("x", 100);
    card.setAttribute("y", 200);
    const paragraph = new Y.XmlElement("paragraph");
    const text = new Y.XmlText();
    text.insert(0, "Keep this card");
    paragraph.insert(0, [text]);
    card.insert(0, [paragraph]);
    fragment.insert(0, [new Y.XmlElement("removedLegacyBlock"), card]);

    const { doc } = initProseMirrorDoc(fragment, schema);

    expect(doc.childCount).toBe(1);
    expect(doc.firstChild.type.name).toBe("boardCard");
    expect(doc.firstChild.attrs.x).toBe(100);
    expect(doc.firstChild.attrs.y).toBe(200);
    expect(doc.textContent).toBe("Keep this card");
    ydoc.destroy();
  });
});
