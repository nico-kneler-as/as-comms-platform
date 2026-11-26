import React, { act } from "react"

Object.assign(globalThis, { React })

import { createRequire } from "node:module"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

const workerRequire = createRequire(
  new URL("../../../worker/package.json", import.meta.url)
)
const { JSDOM } = workerRequire("jsdom") as {
  readonly JSDOM: new (
    html: string,
    options: { readonly url: string }
  ) => { readonly window: Window & typeof globalThis }
}

beforeAll(() => {
  const w = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/"
  }).window
  for (const [key, value] of Object.entries({
    document: w.document,
    Element: w.Element,
    Event: w.Event,
    HTMLElement: w.HTMLElement,
    KeyboardEvent: w.KeyboardEvent,
    MouseEvent: w.MouseEvent,
    MutationObserver: w.MutationObserver,
    Node: w.Node,
    navigator: w.navigator,
    self: w,
    window: w
  })) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value,
      writable: true
    })
  }
  Object.defineProperty(globalThis, "getComputedStyle", {
    configurable: true,
    value: w.getComputedStyle.bind(w),
    writable: true
  })
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

import { RichTextComposerEditor } from "../../app/inbox/_components/composer-editor-surface"

const PHOTO = "https://pub-abc.r2.dev/images/coral.jpg"
const SAVED_HTML = `<p>Hi Ada,</p><img src="${PHOTO}" alt="Coral"><p>With gratitude, G</p>`

let root: Root | null = null
let container: HTMLDivElement | null = null

async function mount(props: { readonly allowImages: boolean }) {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      <RichTextComposerEditor
        bodyPlaintext={"Hi Ada,\n\nWith gratitude, G"}
        initialHtml={SAVED_HTML}
        allowImages={props.allowImages}
        errorMessage={undefined}
        onChange={vi.fn()}
        onClearErrors={vi.fn()}
      />
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
})

describe("broadcast editor photos", () => {
  it("reopens a saved broadcast draft with its photo and text", async () => {
    await mount({ allowImages: true })

    const image = container?.querySelector("img")
    expect(image?.getAttribute("src")).toBe(PHOTO)
    expect(container?.textContent).toContain("With gratitude, G")
  })

  it("never shows photos in an editor that does not allow them (the inbox)", async () => {
    await mount({ allowImages: false })

    expect(container?.querySelector("img")).toBeNull()
    expect(container?.textContent).toContain("Hi Ada,")
  })
})
