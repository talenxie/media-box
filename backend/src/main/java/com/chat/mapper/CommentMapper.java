package com.chat.mapper;

import com.chat.model.Comment;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface CommentMapper {
    List<Comment> findByVideoId(@Param("videoId") Long videoId, @Param("offset") int offset, @Param("limit") int limit);
    int countByVideoId(@Param("videoId") Long videoId);
    int insert(Comment comment);
    int deleteById(@Param("id") Long id);
    int deleteByVideoIds(@Param("videoIds") List<Long> videoIds);
}
