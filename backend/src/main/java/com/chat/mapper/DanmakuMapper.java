package com.chat.mapper;

import com.chat.model.Danmaku;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface DanmakuMapper {
    List<Danmaku> findByVideoId(@Param("videoId") Long videoId);
    int insert(Danmaku danmaku);
    int deleteByVideoId(@Param("videoId") Long videoId);
}
