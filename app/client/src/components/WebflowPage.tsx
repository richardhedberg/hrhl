import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";

type HtmlAttributes = Record<string, string>;

type ParsedContent = {
  bodyHtml: string;
  bodyAttributes: HtmlAttributes;
  htmlAttributes: HtmlAttributes;
  title: string | null;
};

type WebflowOnReady = (container: HTMLElement) => void | (() => void);

type WebflowPageProps = {
  html: string;
  onReady?: WebflowOnReady;
  htmlToRoute?: (href: string) => string | null;
};

const ROUTE_OVERRIDES: Record<string, string> = {
  "index.html": "/",
  "home.html": "/",
  "videos.html": "/videos",
  "teams.html": "/teams",
  "stats.html": "/stats",
  "style-guide.html": "/style-guide",
  "401.html": "/401",
  "404.html": "/404",
};

const DEFAULT_HTML_ROUTE_RESOLVER = (href: string) => {
  try {
    // Ignore anchors, mailto, tel, and absolute URLs.
    if (/^(https?:)?\/\//i.test(href) || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
      return null;
    }
    if (!href.endsWith(".html")) return null;
    const withoutQuery = href.split("?")[0] ?? href;
    const withoutHash = withoutQuery.split("#")[0] ?? withoutQuery;
    const trimmed = withoutHash.replace(/^\.\//, "").replace(/^\/+/, "");
    if (trimmed === "") return "/";
    const override = ROUTE_OVERRIDES[trimmed];
    if (override) return override;
    const slug = trimmed.replace(/\.html$/, "");
    if (!slug) return "/";
    return `/articles/${slug}`;
  } catch {
    return null;
  }
};

const parseHtml = (rawHtml: string): ParsedContent => {
  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    return {
      bodyHtml: rawHtml,
      bodyAttributes: {},
      htmlAttributes: {},
      title: null,
    };
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, "text/html");
  const body = doc.body;
  const htmlEl = doc.documentElement;

  const bodyAttributes: HtmlAttributes = {};
  const htmlAttributes: HtmlAttributes = {};

  if (body) {
    Array.from(body.attributes).forEach((attr) => {
      bodyAttributes[attr.name] = attr.value;
    });
  }

  if (htmlEl) {
    Array.from(htmlEl.attributes).forEach((attr) => {
      htmlAttributes[attr.name] = attr.value;
    });
  }

  const title = doc.title || null;

  return {
    bodyHtml: body?.innerHTML ?? rawHtml,
    bodyAttributes,
    htmlAttributes,
    title,
  };
};

const reinitializeWebflow = () => {
  if (typeof window === "undefined") return;
  const webflow = (window as any).Webflow;
  if (!webflow) return;

  try {
    if (typeof webflow.destroy === "function") {
      webflow.destroy();
    }
    if (typeof webflow.ready === "function") {
      webflow.ready();
    }
    if (typeof webflow.require === "function") {
      const ix2 = webflow.require("ix2");
      if (ix2 && typeof ix2.init === "function") {
        ix2.init();
      }
    }
    if (typeof webflow.refresh === "function") {
      webflow.refresh();
    }
  } catch {
    // Ignore Webflow runtime errors; they are non-critical for rendering.
  }
};

const setupVideoInteractions = (root: HTMLElement) => {
  const cleanups: Array<() => void> = [];

  const resetVideos = () => {
    root.querySelectorAll<HTMLVideoElement>("video").forEach((video) => {
      video.pause();
      try {
        video.currentTime = 0;
      } catch {
        // Ignore failures from setting currentTime on unloaded media.
      }
    });
  };

  root.querySelectorAll<HTMLElement>(".thumb").forEach((thumb) => {
    const handler = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target?.classList.contains("close")) return;
      const video = thumb.querySelector<HTMLVideoElement>("video");
      if (!video) return;
      resetVideos();
      try {
        video.load();
      } catch {
        // Swallow load errors to match original script resilience.
      }
      void video.play();
    };

    thumb.addEventListener("click", handler);
    cleanups.push(() => thumb.removeEventListener("click", handler));
  });

  root.querySelectorAll<HTMLElement>(".close").forEach((closeButton) => {
    const handler = () => {
      resetVideos();
    };

    closeButton.addEventListener("click", handler);
    cleanups.push(() => closeButton.removeEventListener("click", handler));
  });

  return () => {
    cleanups.forEach((cleanup) => cleanup());
  };
};

const WebflowPage = ({ html, onReady, htmlToRoute = DEFAULT_HTML_ROUTE_RESOLVER }: WebflowPageProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();

  const { bodyHtml, bodyAttributes, htmlAttributes, title } = useMemo(() => parseHtml(html), [html]);

  useEffect(() => {
    if (!title) return;
    const prevTitle = document.title;
    document.title = title;
    return () => {
      document.title = prevTitle;
    };
  }, [title]);

  useEffect(() => {
    const previousBodyAttributes = new Map<string, string | null>();
    const previousHtmlAttributes = new Map<string, string | null>();

    Object.entries(bodyAttributes).forEach(([name, value]) => {
      previousBodyAttributes.set(name, document.body.getAttribute(name));
      if (value === "") {
        document.body.setAttribute(name, "");
      } else {
        document.body.setAttribute(name, value);
      }
    });

    Object.entries(htmlAttributes).forEach(([name, value]) => {
      previousHtmlAttributes.set(name, document.documentElement.getAttribute(name));
      if (value === "") {
        document.documentElement.setAttribute(name, "");
      } else {
        document.documentElement.setAttribute(name, value);
      }
    });

    return () => {
      previousBodyAttributes.forEach((prevValue, name) => {
        if (prevValue == null) {
          document.body.removeAttribute(name);
        } else {
          document.body.setAttribute(name, prevValue);
        }
      });
      previousHtmlAttributes.forEach((prevValue, name) => {
        if (prevValue == null) {
          document.documentElement.removeAttribute(name);
        } else {
          document.documentElement.setAttribute(name, prevValue);
        }
      });
    };
  }, [bodyAttributes, htmlAttributes]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const anchors = Array.from(container.querySelectorAll<HTMLAnchorElement>("a[href]"));
    const listeners: Array<{ element: HTMLAnchorElement; handler: (event: MouseEvent) => void }> = [];

    anchors.forEach((anchor) => {
      const href = anchor.getAttribute("href");
      if (!href) return;

      const route = htmlToRoute(href);
      if (!route) return;

      const handler = (event: MouseEvent) => {
        // Allow open in new tab/window or modified click to behave normally.
        if (event.defaultPrevented) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || anchor.target === "_blank") {
          return;
        }

        event.preventDefault();
        navigate(route);
      };

      anchor.setAttribute("href", route);

      anchor.addEventListener("click", handler);
      listeners.push({ element: anchor, handler });
    });

    return () => {
      listeners.forEach(({ element, handler }) => {
        element.removeEventListener("click", handler);
      });
    };
  }, [htmlToRoute, navigate, bodyHtml]);

  useEffect(() => {
    reinitializeWebflow();
    if (typeof window !== "undefined") {
      window.scrollTo(0, 0);
    }
    const container = containerRef.current;
    if (!container) return;

    const docEl = document.documentElement;
    const classesAdded: string[] = [];
    if (!docEl.classList.contains("w-mod-js")) {
      docEl.classList.add("w-mod-js");
      classesAdded.push("w-mod-js");
    }
    const supportsTouch =
      "ontouchstart" in window || (typeof navigator !== "undefined" && (navigator as any).maxTouchPoints > 0);
    if (supportsTouch && !docEl.classList.contains("w-mod-touch")) {
      docEl.classList.add("w-mod-touch");
      classesAdded.push("w-mod-touch");
    }

    const detachVideoHandlers = setupVideoInteractions(container);
    const onReadyCleanup = onReady ? onReady(container) : undefined;

    return () => {
      detachVideoHandlers();
      if (typeof onReadyCleanup === "function") {
        onReadyCleanup();
      }
      classesAdded.forEach((className) => {
        docEl.classList.remove(className);
      });
    };
  }, [bodyHtml, onReady]);

  return <div ref={containerRef} dangerouslySetInnerHTML={{ __html: bodyHtml }} />;
};

export default WebflowPage;
