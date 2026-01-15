import { BoundingBox } from "../types";

export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      // Remove data:image/xxx;base64, prefix for the API call if needed, 
      // but for this helper we return the full string for the Image object
      const base64Clean = result.split(',')[1]; 
      resolve(base64Clean);
    };
    reader.onerror = (error) => reject(error);
  });
};

export const cropImage = (
  imageSource: string, // Full data URL
  box: BoundingBox
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = imageSource;
    img.crossOrigin = "anonymous";
    
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        reject(new Error("Could not get canvas context"));
        return;
      }

      // Convert percentages (0-100) to pixels
      const x = (box.xmin / 100) * img.width;
      const y = (box.ymin / 100) * img.height;
      const w = ((box.xmax - box.xmin) / 100) * img.width;
      const h = ((box.ymax - box.ymin) / 100) * img.height;

      // Add a small padding if desired, or keep exact
      canvas.width = w;
      canvas.height = h;

      ctx.drawImage(
        img,
        x, y, w, h, // Source coords
        0, 0, w, h  // Dest coords
      );

      resolve(canvas.toDataURL("image/jpeg", 0.95));
    };

    img.onerror = (err) => reject(err);
  });
};