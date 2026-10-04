-- CreateTable
CREATE TABLE "blog_post_technologies" (
    "blog_post_id" TEXT NOT NULL,
    "technology_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blog_post_technologies_pkey" PRIMARY KEY ("blog_post_id","technology_id")
);

-- CreateIndex
CREATE INDEX "blog_post_technologies_technology_id_idx" ON "blog_post_technologies"("technology_id");

-- AddForeignKey
ALTER TABLE "blog_post_technologies" ADD CONSTRAINT "blog_post_technologies_blog_post_id_fkey" FOREIGN KEY ("blog_post_id") REFERENCES "blog_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_post_technologies" ADD CONSTRAINT "blog_post_technologies_technology_id_fkey" FOREIGN KEY ("technology_id") REFERENCES "technologies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
