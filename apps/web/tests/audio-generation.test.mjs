import { afterEach, describe, expect, test } from "bun:test";
import {
  generateAudioBlock,
  generateScript,
  uploadNewAudioFile,
} from "../services/blocks/Audio/audio.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("single-speaker audio generation", () => {
  test("defaults to TTS and preserves voice, style and language", async () => {
    let request;
    const block = { block_uuid: "block_audio", content: { file_id: "audio.wav" } };
    globalThis.fetch = async (url, options) => {
      request = { url, options };
      return Response.json(block);
    };

    expect(await generateAudioBlock({
      activity_uuid: "activity_a", text: "Hello", voice: "Kore",
      style: "Warm", language: "English",
    }, "test-token")).toEqual(block);
    expect(request.url).toEndWith("ai/audio/generate");
    expect(request.options.method).toBe("POST");
    expect(request.options.headers.get("Authorization")).toBe("Bearer test-token");
    expect(JSON.parse(request.options.body)).toEqual({
      activity_uuid: "activity_a", mode: "tts", text: "Hello", voice: "Kore",
      style: "Warm", language: "English",
    });
  });

  test("defaults scripting to a monologue and preserves the requested length", async () => {
    let request;
    globalThis.fetch = async (url, options) => {
      request = { url, options };
      return Response.json({ transcript: "A detailed explanation." });
    };

    expect(await generateScript({
      activity_uuid: "activity_a", text: "Explain photosynthesis",
      minutes: 5, language: "English", style: "Educational",
    }, "test-token")).toEqual({ transcript: "A detailed explanation." });
    expect(request.url).toEndWith("ai/audio/script");
    expect(JSON.parse(request.options.body)).toEqual({
      activity_uuid: "activity_a", mode: "speak", text: "Explain photosynthesis",
      minutes: 5, language: "English", style: "Educational",
    });
  });

  test.each([generateAudioBlock, generateScript])("surfaces generation validation errors", async (generate) => {
    globalThis.fetch = async () => Response.json({ detail: [{ msg: "Text is required" }] }, { status: 422 });
    await expect(generate({ activity_uuid: "activity_a", text: "" }, "test-token"))
      .rejects.toThrow("Text is required");
  });

  test("ordinary audio uploads still send multipart files to the audio block endpoint", async () => {
    let request;
    globalThis.fetch = async (url, options) => {
      request = { url, options };
      return Response.json({ block_uuid: "block_upload" });
    };
    const file = new File(["audio"], "recording.wav", { type: "audio/wav" });

    expect(await uploadNewAudioFile(file, "activity_a", "test-token"))
      .toEqual({ block_uuid: "block_upload" });
    expect(request.url).toEndWith("blocks/audio");
    expect(request.options.body.get("activity_uuid")).toBe("activity_a");
    expect(request.options.body.get("file_object").name).toBe("recording.wav");
    expect(request.options.headers.has("Content-Type")).toBe(false);
  });
});
