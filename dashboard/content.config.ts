import { defineContentConfig, defineCollection, z } from "@nuxt/content";

export default defineContentConfig({
  collections: {
    docs: defineCollection({
      type: "page",
      source: "docs/**",
      schema: z.object({
        icon: z.string().optional(),
      }),
    }),
  },
});
