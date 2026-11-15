-- Article supprimé d'une boutique : sa suggestion n'y apparaît plus à l'ajout de stock
ALTER TABLE "product_suggestions" ADD COLUMN "hiddenCenterIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
