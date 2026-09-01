package com.chat.mapper;

import com.chat.model.Video;
import com.chat.model.VideoLike;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface VideoLikeMapper {
    VideoLike findByVideoAndUser(@Param("videoId") Long videoId, @Param("userId") Long userId);
    int insert(VideoLike like);
    int delete(@Param("videoId") Long videoId, @Param("userId") Long userId);
    List<Video> findLikedVideosByUser(@Param("userId") Long userId, @Param("offset") int offset, @Param("limit") int limit);
    List<Video> findLikedVideosByUserWithFilter(@Param("userId") Long userId, @Param("offset") int offset, @Param("limit") int limit, @Param("keyword") String keyword, @Param("type") String type, @Param("category") String category);
    int countLikedVideosByUser(@Param("userId") Long userId);
    int countLikedVideosByUserWithFilter(@Param("userId") Long userId, @Param("keyword") String keyword, @Param("type") String type, @Param("category") String category);
    int deleteByVideoIds(@Param("videoIds") List<Long> videoIds);
}
