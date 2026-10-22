package com.whitecobalt.anglertackle.network;

import com.whitecobalt.anglertackle.AnglersTackle;
import com.whitecobalt.anglertackle.guide.GuideData;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

import java.util.ArrayList;
import java.util.List;

/**
 * 服务端 → 客户端：打开教程书。
 *
 * <p>直接把当前章节的内容随包发过去（章节都是短文本，几 KB 以内），
 * 客户端不需要自己读数据文件——这样专用服务器上也能正常翻页。
 *
 * @param titles      章节目录（用于左侧列表）
 * @param index       当前章节序号
 * @param chapterTitle 当前章节标题
 * @param pages       当前章节的页，每页是若干行文本
 */
public record GuidePayload(
        List<String> titles,
        int index,
        String chapterTitle,
        List<List<String>> pages
) implements CustomPacketPayload {

    public static final CustomPacketPayload.Type<GuidePayload> TYPE =
            new CustomPacketPayload.Type<>(
                    ResourceLocation.fromNamespaceAndPath(AnglersTackle.MOD_ID, "guide"));

    public static final StreamCodec<FriendlyByteBuf, GuidePayload> STREAM_CODEC = StreamCodec.of(
            (buf, p) -> {
                buf.writeByte(p.titles.size());
                for (String t : p.titles) {
                    buf.writeUtf(t);
                }
                buf.writeByte(p.index);
                buf.writeUtf(p.chapterTitle);
                buf.writeByte(p.pages.size());
                for (List<String> page : p.pages) {
                    buf.writeByte(page.size());
                    for (String line : page) {
                        buf.writeUtf(line);
                    }
                }
            },
            buf -> {
                int titleCount = buf.readByte();
                List<String> titles = new ArrayList<>(titleCount);
                for (int i = 0; i < titleCount; i++) {
                    titles.add(buf.readUtf());
                }
                int index = buf.readByte();
                String title = buf.readUtf();
                int pageCount = buf.readByte();
                List<List<String>> pages = new ArrayList<>(pageCount);
                for (int i = 0; i < pageCount; i++) {
                    int lineCount = buf.readByte();
                    List<String> lines = new ArrayList<>(lineCount);
                    for (int j = 0; j < lineCount; j++) {
                        lines.add(buf.readUtf());
                    }
                    pages.add(lines);
                }
                return new GuidePayload(titles, index, title, pages);
            }
    );

    /** 从服务端当前加载的教程书数据组装一个包。 */
    public static GuidePayload of(int index) {
        GuideData.Chapter chapter = GuideData.chapter(index);
        return new GuidePayload(GuideData.titles(), index, chapter.title(), chapter.pages());
    }

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
