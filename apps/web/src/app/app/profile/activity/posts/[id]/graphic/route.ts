import { isGraphicStyle, readVisual } from "@le/shared";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { drawPostGraphic, loadGraphicContext } from "@/lib/post-graphic";

export const dynamic = "force-dynamic";

/**
 * The graphic for one post, as the posts page shows it.
 *
 * An approved or published post shows the picture stored at approval, which
 * is the one that goes out or went out. A draft is drawn from its current
 * picture and style, in the company's colours. Only the rep's own posts, as
 * the page lists them.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const supabase = await createClient();
  const { data: post } = await supabase
    .from("linkedin_posts")
    .select("id, status, approved_at, graphic_enabled, graphic_headline, graphic_spec, graphic_style, format")
    .eq("id", id)
    .eq("workspace_id", session.workspaceId)
    .eq("user_id", session.userId)
    .maybeSingle();
  if (!post || !post.graphic_enabled) return new Response("Not found", { status: 404 });

  if (post.approved_at || post.status === "published") {
    const { data: stored } = await supabase
      .from("linkedin_post_graphics")
      .select("png_base64")
      .eq("post_id", post.id)
      .eq("workspace_id", session.workspaceId)
      .maybeSingle();
    if (stored?.png_base64) {
      return new Response(Buffer.from(stored.png_base64, "base64"), {
        headers: { "content-type": "image/png", "cache-control": "private, max-age=60" },
      });
    }
  }

  const visual = readVisual(post.graphic_headline, post.graphic_spec);
  if (!visual) return new Response("Not found", { status: 404 });
  const context = await loadGraphicContext(supabase, session);
  const image = await drawPostGraphic({
    visual,
    style: isGraphicStyle(post.graphic_style) ? post.graphic_style : "brand",
    format: post.format,
    ...context,
  });
  const png = await image.arrayBuffer();
  return new Response(png, { headers: { "content-type": "image/png", "cache-control": "private, no-store" } });
}
