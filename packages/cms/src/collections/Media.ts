import { CollectionConfig } from "payload/types";
import path from "path";

const Media: CollectionConfig = {
  slug: "cms-media",
  labels: {
    singular: "CMS Media",
    plural: "CMS Media",
  },
  access: {
    read: () => true,
  },
  admin: {
    useAsTitle: "filename",
  },
  upload: {
    adminThumbnail: "thumbnail",
    staticDir: path.resolve(__dirname, "../../media"),
    mimeTypes: ["image/*", "application/pdf"],
    imageSizes: [
      {
        name: "thumbnail",
        width: 250,
        height: 250,
      },
      {
        name: "medium",
        width: 768,
        height: 768,
      },
      {
        name: "large",
        width: 1920,
        height: null, // auto height for large
      },
      {
        name: "portrait",
        width: 320,
        height: 360,
      },
    ],
  },
  fields: [
    {
      name: "alt",
      label: "Alt Text",
      type: "text",
    },
  ],
};

export default Media;
