package com.chat.service;

import com.chat.mapper.UserMapper;
import com.chat.model.User;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

@Service
public class UserService {

    @Resource
    private UserMapper userMapper;

    private final Map<String, Long> tokenStore = new HashMap<>();

    public Map<String, Object> login(String username, String password) {
        User user = userMapper.findByUsername(username);
        if (user == null || !user.getPassword().equals(password)) {
            return null;
        }
        String token = UUID.randomUUID().toString().replace("-", "");
        tokenStore.put(token, user.getId());
        Map<String, Object> result = new HashMap<>();
        result.put("token", token);
        result.put("user", user);
        return result;
    }

    public User getUserByToken(String token) {
        Long userId = tokenStore.get(token);
        if (userId == null) return null;
        return userMapper.findById(userId);
    }

    public boolean isValidToken(String token) {
        return token != null && tokenStore.containsKey(token);
    }

    public User getUserById(Long userId) {
        return userMapper.findById(userId);
    }

    public void saveSettings(Long userId, String settings) {
        userMapper.updateSettings(userId, settings);
    }
}
