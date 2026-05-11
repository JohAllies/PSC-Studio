import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUserScript, getUserStorageUsage, listUserScripts } from "./scripts";

const getUser = vi.fn();
const upload = vi.fn();
const list = vi.fn();
const move = vi.fn();
const remove = vi.fn();
const download = vi.fn();
const fromStorage = vi.fn();

vi.mock("./client", () => ({
  getSupabaseClient: () => ({
    auth: {
      getUser,
    },
    storage: {
      from: fromStorage,
    },
  }),
}));

describe("cloud scripts storage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("crypto", {
      randomUUID: () => "script-uuid",
    });

    getUser.mockReset();
    upload.mockReset();
    list.mockReset();
    move.mockReset();
    remove.mockReset();
    download.mockReset();
    fromStorage.mockReset();

    getUser.mockResolvedValue({
      data: {
        user: {
          id: "user-uuid",
        },
      },
      error: null,
    });

    fromStorage.mockReturnValue({
      upload,
      list,
      move,
      remove,
      download,
    });

    list
      .mockResolvedValueOnce({
        data: [],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          {
            name: "script-uuid__My Script.json",
            created_at: "2026-05-11T00:00:00.000Z",
            updated_at: "2026-05-11T00:00:00.000Z",
            metadata: {
              size: 2,
            },
          },
        ],
        error: null,
      });

    upload.mockResolvedValue({
      error: null,
    });
  });

  it("stores scripts in the user_scripts bucket under the user's UUID folder", async () => {
    const created = await createUserScript("My Script.json", "{}");

    expect(fromStorage).toHaveBeenCalledWith("user_scripts");
    expect(upload).toHaveBeenCalledWith(
      "user-uuid/script-uuid__My Script.json",
      expect.any(Blob),
      expect.objectContaining({
        contentType: "application/json",
        upsert: false,
      }),
    );
    expect(created).toEqual({
      id: "user-uuid/script-uuid__My Script.json",
      name: "My Script.json",
      sizeBytes: 2,
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:00:00.000Z",
    });
  });

  it("computes usage and listing directly from storage objects", async () => {
    list.mockReset();
    list.mockResolvedValue({
      data: [
        {
          name: "first__Alpha.json",
          created_at: "2026-05-10T00:00:00.000Z",
          updated_at: "2026-05-11T00:00:00.000Z",
          metadata: { size: 4 },
        },
        {
          name: "second__Beta.json",
          created_at: "2026-05-09T00:00:00.000Z",
          updated_at: "2026-05-12T00:00:00.000Z",
          metadata: { size: 6 },
        },
      ],
      error: null,
    });

    await expect(getUserStorageUsage()).resolves.toBe(10);
    await expect(listUserScripts()).resolves.toEqual([
      {
        id: "user-uuid/second__Beta.json",
        name: "Beta.json",
        sizeBytes: 6,
        createdAt: "2026-05-09T00:00:00.000Z",
        updatedAt: "2026-05-12T00:00:00.000Z",
      },
      {
        id: "user-uuid/first__Alpha.json",
        name: "Alpha.json",
        sizeBytes: 4,
        createdAt: "2026-05-10T00:00:00.000Z",
        updatedAt: "2026-05-11T00:00:00.000Z",
      },
    ]);
  });
});
